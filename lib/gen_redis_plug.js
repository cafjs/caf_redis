// Modifications copyright 2020 Caf.js Labs and contributors
/*!
Copyright 2013 Hewlett-Packard Development Company, L.P.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
'use strict';
/**
 * Generic plug to manage a `Redis` connection.
 *
 * Properties:
 *
 *     {nodeId: string=, paas: string, redis: {password: string|null,
 *                                            hostname: string, port: number},
 *      coalescing: {interval: number, maxPendingUpdates: number},
 *      compressState: boolean}
 *
 * where:
 *
 *  * `nodeId:` is an optional, default identifier for the lease owner of all
 *  the CAs that use this plug. Mostly for debugging.
 *  * `paas:` a name for a service to dynamically lookup configuration that will
 * override the one defined here.
 *  * `interval:` the number of miliseconds that we delay update requests,
 * so that we can aggregate them in a single request.
 *  * `maxPendingUpdates:` The maximum number of pending updates before
 *  we flush them in a single request.
 *  * `redis:` standard `Redis` configuration.
 *  * `compressState`: Whether to compress checkpointed state. Typically turned
 * off for debugging.
 *
 * @module caf_redis/gen_redis_plug
 * @augments external:caf_components/gen_plug
 *
 */
// @ts-ignore: augments not attached to a class
const assert = require('assert');
const redis = require('redis');
const caf_comp = require('caf_components');
const async = caf_comp.async;
const myUtils = caf_comp.myUtils;
const genPlug = caf_comp.gen_plug;
const genCron = caf_comp.gen_cron;
const utilR = require('./util_redis');

const PING_RATIO = 100; //typical 10msec * 100 = 1sec between redis pings

exports.create = function($, spec) {

    if ($._.$.log && $._.$.log.isActive('TRACE')) {
        redis.debug_mode = true;
    }
    assert.equal(typeof(spec.env.coalescing), 'object',
                 "'spec.env.coalescing' is not an object");
    assert.equal(typeof(spec.env.coalescing.maxPendingUpdates), 'number',
                 "'spec.env.coalescing.maxPendingUpdates' is not a number");
    assert.equal(typeof(spec.env.coalescing.interval), 'number',
                 "'spec.env.coalescing.interval' is not a number");
    assert.equal(typeof(spec.env.compressState), 'boolean',
                 "'spec.env.compressState' is not a boolean");

    const maxPendingUpdates = spec.env.coalescing.maxPendingUpdates;

    /* config type is {password: <null| string>, hostname: <string>,
     port: <integer>}.*/
    const config = spec.env.redis;
    assert.ok((typeof(config.password) === 'string') ||
              (config.password === null),
              "'config.password' not null or string");
    assert.equal(typeof(config.hostname), 'string',
                 "'config.hostname' not a string");
    assert.equal(typeof(config.port), 'number',
                 "'config.port' not a number");

    const cronSpec = {
        name: spec.name + '_cron__',
        module: 'gen_cron', // module ignored
        env: {interval: spec.env.coalescing.interval}
    };
    const updateCron = genCron.create(null, cronSpec);

    const that = genPlug.create($, spec);

    /**
     * Run-time type information.
     *
     * @type {boolean}
     * @memberof! module:caf_redis/gen_redis_plug#
     * @alias __ca_isRedisPlug__
     */
    that.__ca_isRedisPlug__ = true;

    var clientRedis = null;
    var luaHashes = {};
    var pendingUpdates = [];
    var counter = 0;

    /**
     * Gets a connection to Redis.
     *
     * @return {Object} A connection to Redis.
     *
     * @memberof! module:caf_redis/gen_redis_plug#
     * @alias __ca_getClientRedis__
     */
    that.__ca_getClientRedis__ = function() {
        return clientRedis;
    };

    /**
     * Sends a LUA command to Redis.
     *
     * @param {string} op Operation to perform.
     * @param {Array.<string>} ids CA identifiers.
     * @param {Array.<Object>} argsList Arguments to LUA command.
     * @param {cbType} cb A callback called with the response to the LUA
     *  command.
     *
     * @memberof! module:caf_redis/gen_redis_plug#
     * @alias __ca_doLuaOp__
     */
    that.__ca_doLuaOp__ = function(op, ids, argsList, cb) {
        if (that.__ca_isShutdown__) {
            const err = new Error('Shutdown redis plug cannot process LUA op');
            err['op'] = op;
            err['ids'] = ids;
            err['argsList'] = argsList;
            cb(err);
        } else {
            const cb0 = function(err, data) {
                if (err) {
                    const argsStr =
                          argsList.map(x => utilR.decompressJSON(x).toString());
                    const newErr = new Error('Error in LUA operation');
                    newErr['err'] = err;
                    newErr['op'] = op;
                    newErr['ids'] = ids;
                    newErr['argsList'] = argsStr;
                    cb(newErr);
                } else {
                    cb(err, data);
                }
            };
            const args = [luaHashes[op], ids.length]
                .concat(ids)
                .concat(argsList);
            clientRedis.send_command('evalsha', args, cb0);
        }
    };

    /**
     * Sends a PING command to Redis.
     *
     *
     * @memberof! module:caf_redis/gen_redis_plug#
     * @alias __ca_ping__
     */
    that.__ca_ping__ = function() {
        if (!clientRedis.pub_sub_mode) {
            clientRedis.send_command('ping', [], function(err, x) {
                if (err) {
                    $._.$.log && $._.$.log.debug('Exception in Redis ping' +
                                                 myUtils.errToPrettyStr(x));
                } else if (x !== 'PONG') {
                    $._.$.log && $._.$.log.debug('Cannot ping Redis');
                }
            });
        }
    };

    const registerScripts = function(all, cb) {
        const seriesF = {};
        const newF = function(script) {
            return function(cb1) {
                clientRedis.send_command('SCRIPT', ['LOAD', script], cb1);
            };
        };
        for (let scriptName in all) {
            seriesF[scriptName] = newF(all[scriptName]);
        }
        /* We could have used 'parallel', but 'series' is easier to debug, and
         *  performance is not an issue for a one-off initialization.*/
        async.series(seriesF, cb);
    };

    /**
     * Queues a callback/command pair for future execution, so that we can
     * aggregate commands into a single LUA script.
     *
     * @param {cbType} callback A callback to return results/error for the
     *  queued command.
     * @param {Object} command A command to be queued for future execution.
     *
     * @memberof! module:caf_redis/gen_redis_plug#
     * @alias __ca_queue__
     */
    that.__ca_queue__ = function(callback, command) {
        pendingUpdates.push({callback: callback, command: command});
    };

    /**
     * Flushes pending commands, combining them by using a given function.
     *
     * @param {function(Array.<Object>, cbType):void} flushF A hook function
     * of type `function(Array.<Object>, cbType):void` to
     * process a sequence of commands, and call a callback with the combined
     * results or an error.
     * @param {boolean} force True if we flush regardless of the number of
     * pending updates. False, if we only flush when the threshold of queue size
     *  was exceeded.
     *
     * @memberof! module:caf_redis/gen_redis_plug#
     * @alias __ca_flush__
     */
    that.__ca_flush__ = function(flushF, force) {
        counter = counter + 1;
        if (counter % PING_RATIO === 0) {
            // keep connection alive when not active.
            that.__ca_ping__();
        }
        if ((pendingUpdates.length >= maxPendingUpdates) ||
            (force && pendingUpdates.length > 0)) {
            const pending = myUtils.clone(pendingUpdates);
            const commands = pending.map(function(x) { return x.command;});
            const callbacks = pending.map(function(x) { return x.callback;});
            pendingUpdates = [];
            const cb = function(err, response) {
                if (err) {
                    $._.$.log &&
                        $._.$.log.debug('__ca_flush__:Retrying separate' +
                                        ' err=' + myUtils.errToPrettyStr(err));
                    // retry separately
                    pending.forEach(function(x) {
                        process.nextTick(function() {
                            flushF([x.command], x.callback);
                        });
                    });
                } else {
                    callbacks.forEach(function(x) {
                        process.nextTick(function() {
                            x(err, response);
                        });
                    });
                }
            };
            process.nextTick(function() { flushF(commands, cb);});
        }
    };

    /**
     * Initializes the Redis connection/LUA scripts. This can only be done once.
     *
     * `redisType` type is
     *
     *  {port: number, hostname: string, password: string=}
     *
     * @param {redisType=} optConfig Optional host/port/password for redis
     * service that overrides the  defaults.
     * @param {Object.<string, string>} lua A map with script names
     * (keys) and LUA script source codes (values).
     * @param {function(cbType)=} flushF An optional flush function to process
     * pending updates.
     * @param {cbType} cb A callback to continue after initialization.
     *
     * @memberof! module:caf_redis/gen_redis_plug#
     * @alias __ca_initClient__
     */
    that.__ca_initClient__ = function(optConfig, lua, flushF, cb) {
        if (clientRedis) {
            const err = new Error('Redis: initializating twice');
            err['optConfig'] = optConfig;
            cb(err);
        } else {
            const newConfig = myUtils.cloneAndMixin(config, optConfig || {});
            clientRedis = redis.createClient(newConfig.port,
                                             newConfig.hostname,
                                             {detect_buffers: true});
            clientRedis
                .on('error', function(err) {
                    $._.$.log &&
                        $._.$.log.error('Error: Redis connection:' +
                                        JSON.stringify(newConfig) + ' ' +
                                        myUtils.errToPrettyStr(err));
                    /*
                     * We don't want 'node_redis' to retry or exit. So we
                     * need to install an error handler that ends the
                     * connection, and just in case, shuts down (again)
                     * the plug.
                     */
                    clientRedis && clientRedis.end(true);
                    that.__ca_shutdown__(null, function() {
                        // ignore
                    });
                })
                .on('end', function() {
                    that.__ca_shutdown__(null, function() {
                        // ignore
                    });
                });
            if (flushF) {
                updateCron.__ca_start__(function() {
                    that.__ca_flush__(flushF, true);
                });
            }
            async.series([
                function(cb0) {
                    if (!newConfig.password) {
                        cb0(null);
                    } else {
                        clientRedis.auth(newConfig.password, cb0);
                    }
                },
                function(cb0) {
                    registerScripts(lua, cb0);
                }
            ], function(err, data) {
                if (err) {
                    $._.$.log && $._.$.log.error('Error Redis init:' +
                                        myUtils.errToPrettyStr(err));
                    that.__ca_shutdown__(null, function() {
                        cb(err);
                    });
                } else {
                    luaHashes = data[1];
                    cb(null, that);
                }
            });
        }
    };

    const super__ca_shutdown__ = myUtils.superior(that, '__ca_shutdown__');
    that.__ca_shutdown__ = function(data, cb) {
        if (that.__ca_isShutdown__) {
            // do nothing, return OK
            cb(null);
        } else {
            super__ca_shutdown__(data, function(err) {
                if (err) {
                    cb(err);
                } else {
                    updateCron && updateCron.__ca_stop__();
                    /* Tries to close the connection gracefully, i.e.,
                     * processing all replies and sending the QUIT command,
                     * but if that fails, it uses the hammer.
                     */
                    if (clientRedis) {
                        clientRedis.quit(function(err) {
                            if (err) {
                                clientRedis.end(true);
                                $._.$.log &&
                                    $._.$.log.warn('Redis: Cannot cleanly' +
                                                   ' quit connection: ' +
                                                   myUtils.errToPrettyStr(err));
                                cb(null);
                            } else {
                                cb(null);
                            }
                        });
                    } else {
                        cb(null);
                    }
                }
            });
        }
    };

    return that;
};
