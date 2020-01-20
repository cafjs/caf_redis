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
 * A plug  to access an external checkpointing service that supports
 * LUA scripting (Redis version >= 2.6).
 *
 * The goal is to enable full pipelining of requests
 * while still guaranteeing  ownership of leases during operations.
 *
 * Lua scripts are executed atomically by the server, and therefore, we can
 * combine the check and the update in the same script.
 *
 * We also implement coalescing of state updates across different CAs in a
 *  single script, to amortize the setup cost of LUA with several
 * updates.
 *
 * This improves dramatically Redis throughput, and also reduces
 * client overhead.
 *
 * The drawback is an increase in latency when the system is
 * not under heavy load, and we need a `cron` to bound that increase.
 *
 * Typical coalescing config  values for a fast server are a maximum
 * of 10 requests or 10 extra msec. Note that cron scheduling is not very
 * accurate under load, and we also need a limit on the number of
 * pending requests.
 *
 * @module caf_redis/plug_checkpoint
 * @augments module:caf_redis/gen_redis_plug
 */
// @ts-ignore: augments not attached to a class
const assert = require('assert');
const genRedisPlug = require('./gen_redis_plug');
const json_rpc = require('caf_transport').json_rpc;
const utilR = require('./util_redis');

const CACHE_PREFIX = 'cache:';

const BITS_PREFIX = 'bits:';

const MAP_PREFIX = 'map:';

const PUBSUB_PREFIX = 'pubsub:';

const luaPreamble = 'local owners = redis.call("mget", unpack(KEYS)) \
local data = {} \
for i =1, #KEYS, 1 do \
if owners[i] ~= ARGV[1] then \
local owner = owners[i] or "nobody"\
return { err = KEYS[i] .. " is owned by " ..  owner .. " not " .. ARGV[1]} \
else \
data[i] = "data:" .. KEYS[i]\
end \
end ';

/*
 * Bulk update of CA states. It returns an error (without doing any changes)
 * if any of the CAs are not owned by this node.
 *
 * KEYS is an array with all the CA ids
 * ARGV[1] is the local nodeId
 * ARGV[i+1] for i=1, #KEYS is the new states for those CAs
 *
 */
/*eslint-disable */
const luaUpdateState = luaPreamble +
    'local mixed = {} \
    if (#data ~= (#ARGV -1)) then \
    return { err = "wrong number of arguments" .. (#ARGV -1) " instead of " .. #data} \
    end \
    for i =1, #data, 1 do \
    mixed[2*i-1] = data[i] \
    mixed[2*i] = ARGV[i+1] \
    end \
    return redis.call("mset", unpack(mixed))';
/*eslint-enable */

/*
 * Bulk delete of CA states. It returns an error (without doing any changes)
 * if any of the CAs are not owned by this node.
 *
 * KEYS is an array with all the CA ids
 * ARGV[1] is the local nodeId
 */
const luaDeleteState = luaPreamble + 'return  redis.call("del", unpack(data))';

/*
 * Bulk query of states. It returns an error (without doing any changes)
 * if any of the CAs are not owned by this node.
 *
 * KEYS is an array with all the CA ids
 * ARGV[1] is the local nodeId
 *
 * returns an array of string representing CA states
 *
 */
const luaGetState = luaPreamble + 'return  redis.call("mget", unpack(data))';

/*
 * Grabs leases for a set of CAs.
 *
 * KEYS is an array with all the CA ids
 * ARGV[1] is the nodeId
 * ARGV[2] is the timeout in seconds
 *
 * Returns an array of size #KEYS with false entries for sucessfull lease grabs
 * and a remote owner (string)  for the others.
 */
const luaGrabLease = 'local owners = redis.call("mget", unpack(KEYS)) \
local leases = {} \
for i =1, #KEYS, 1 do \
if not owners[i] then \
redis.call("set", KEYS[i], ARGV[1]) \
redis.call("expire", KEYS[i], tonumber(ARGV[2])) \
table.insert(leases, false) \
elseif  owners[i] == ARGV[1] then \
table.insert(leases, false) \
else \
table.insert(leases, owners[i]); \
end \
end \
return leases';

/*
 * Find a not used external nodeId, and associate with it a local nodeID. Set
 * a lease for this association.
 *
 *  KEYS is an array with all the possible external nodeIds
 *  ARGV[1] is the local nodeId
 *  ARGV[2] is the timeout in seconds
 *
 * Returns an error if it cannot find an available external nodeId or the
 * allocated external nodeId.
 *
 *
 *
 */
const luaGrabNodeLease ='local owners = redis.call("mget", unpack(KEYS)) \
for i =1, #KEYS, 1 do \
if owners[i] == ARGV[1] then \
redis.call("expire", KEYS[i], tonumber(ARGV[2])) \
return KEYS[i] \
end \
end \
for i =1, #KEYS, 1 do \
if not owners[i] then \
redis.call("set", KEYS[i], ARGV[1]) \
redis.call("expire", KEYS[i], tonumber(ARGV[2])) \
return KEYS[i] \
end \
end \
return { err = "No free external nodeIds."}';

/*
 * List status of external nodeIds.
 *
 *  KEYS is an array with all the possible external nodeIds
 *
 * Returns an array with nil or string depending on whether the error if it
 * cannot find an available external nodeId or the
 * allocated external nodeId.
 *
 *
 *
 */
const luaListNodes = 'return redis.call("mget", unpack(KEYS))';

/*
 * List the status of all external nodeIds.
 *
 *  KEYS is implicit
 *
 *  ARGV[1] is the nodeId
 *  ARGV[2] is the search prefix common to all nodeIds.
 *
 * Returns an array with a key in position 2*i and a value in 2*i+1
 * for each node.
 *
 *
 */
const luaListAllNodes = 'local matches = redis.call("KEYS", ARGV[2]) \
local nodes = {} \
for _,key in ipairs(matches) do \
local val = redis.call("GET", key) \
table.insert(nodes, key) \
table.insert(nodes, val) \
end \
return nodes';


/*
 *  Bulk renewal of leases associated to CAs.
 *
 *   KEYS is an array with all the CA ids
 * ARGV[1] is the local nodeId
 * ARGV[2] is the timeout in seconds
 *
 * Returns an array with all the keys corresponding to CAs that we failed to
 *  renew.
 *
 */
const luaRenewLeases =
    'local owners = redis.call("mget", unpack(KEYS)) \
    local gone = {} \
    for i =1, #KEYS, 1 do \
    if owners[i] ~= ARGV[1] then \
    table.insert(gone, KEYS[i]) \
    else \
    redis.call("expire", KEYS[i], tonumber(ARGV[2])) \
    end \
    end \
    return gone';


/*
 * Lookup cache entries.
 *
 *  KEYS is an array with the cache keys.
 *
 * Returns the cached values for those keys.
 *
 */
const luaGetCache ='return  redis.call("mget", unpack(KEYS))';


/*
 * Update a cache entry. Cache entries expire after an interval for GC.
 *
 * KEYS is an array with one cache key
 * ARGV[1] is the new value
 * ARGV[2] is the timeout in seconds
 *
 */
const luaUpdateCache = 'redis.call("set", KEYS[1], ARGV[1]) \
return redis.call("expire", KEYS[1], tonumber(ARGV[2]))';

/*
 * Sets bits in a bitfield.
 *
 * KEYS is an array with the field name
 * ARGV is an array with bit indexes to set
 *
 */
const luaSetBits = 'for i =1, #ARGV, 1 do \
  redis.call("setbit", KEYS[1], ARGV[i], 1)  \
end ';

/*
 * Clear bits in a bitfield.
 *
 * KEYS is an array with the field name
 *
 */
const luaClearBits = 'redis.call("del", KEYS[1])';

/*
 * Check bits in a bitfield. Return null if any not set, otherwise `true`.
 *
 * KEYS is an array with the field name
 * ARGV is an array with bit indexes to check
 *
 */
const luaCheckBits = 'for i =1, #ARGV, 1 do \
  local value = redis.call("getbit", KEYS[1], ARGV[i])  \
  if (value ~= 1) then \
     return nil \
  end \
end \
return true';

/*
 * Creates a new map or returns existing one.
 *
 * KEYS map name
 * ARGV key value pairs
 *
 */
const luaCreateMap =
'if redis.call("exists", KEYS[1]) == 0 then \
   redis.call("hmset", KEYS[1], unpack(ARGV)) \
 end \
 return redis.call("hgetall", KEYS[1]) ';

/*
 * Gets the contents of a map or nil if it doesn't exist.
 * KEYS map name
 *
 */
const luaReadMap =
'if redis.call("exists", KEYS[1]) == 0 then \
   return { err = "Map does not exist."} \
else \
   return redis.call("hgetall", KEYS[1]) \
end';

/*
 * Deletes a  map.
 *
 * KEYS map name
 *
 */
const luaDeleteMap =
'return redis.call("del", KEYS[1])';


/*
 * Updates a map after checking a matching version. It also publishes the
 * change to a channel of the same key, with a JSON serialized string of the
 * form :
 *   {"__ca_version__" : <number>, "delete" : Array.<string>,
 *    "add" : Array.<string>}
 *
 * If the proposed version number is smaller than the current one we ignore
 * the update. If it is larger, we throw an error.
 *
 * KEYS map name
 *
 * ARGV[1] version
 * ARGV[2] #number of deleted hash keys
 * ARGV[3].. ARGV[ARGV[2] +2] deleted keys
 * ARGV[ARGV[2] +3] ... added key value pairs
 */
const luaUpdateMap =
'local deleteKeys = {} \
local addedProps = {} \
local toPublish = {} \
local numDeleteKeys = tonumber(ARGV[2]) \
local numAddedProps = #ARGV - numDeleteKeys -2 \
if redis.call("exists", KEYS[1]) == 0 then \
   return {err = "CA " .. KEYS[1] .. " does not exist"} \
end \
local oldVersion =  redis.call("hget", KEYS[1], "__ca_version__") \
if ARGV[1]  > oldVersion then \
   return  {err = "CA " .. KEYS[1] .. " version " .. ARGV[1] .. \
            " does not match"} \
elseif ARGV[1]  < oldVersion then \
      return  oldVersion \
else \
   if numDeleteKeys > 0 then \
      for  i = 1, numDeleteKeys, 1 do \
         deleteKeys[i] = ARGV[i+2] \
      end \
      redis.call("hdel", KEYS[1], unpack(deleteKeys)) \
   end \
   for i = 1, numAddedProps, 1 do \
      addedProps[i] = ARGV[numDeleteKeys + 2 + i] \
   end \
   toPublish["version"] = tonumber(ARGV[1]) \
   toPublish["remove"] = deleteKeys \
   toPublish["add"] = addedProps \
   redis.call("hmset", KEYS[1], unpack(addedProps)) \
   return redis.call("publish", KEYS[1], cjson.encode(toPublish)) \
end';

const luaAll = {
    updateState: luaUpdateState,
    deleteState: luaDeleteState,
    getState: luaGetState,
    grabLease: luaGrabLease,
    grabNodeLease: luaGrabNodeLease,
    listNodes: luaListNodes,
    listAllNodes: luaListAllNodes,
    renewLeases: luaRenewLeases,
    updateCache: luaUpdateCache,
    getCache: luaGetCache,
    createMap: luaCreateMap,
    readMap: luaReadMap,
    updateMap: luaUpdateMap,
    deleteMap: luaDeleteMap,
    setBits: luaSetBits,
    checkBits: luaCheckBits,
    clearBits: luaClearBits
};


const NODE_KEY_PREFIX = 'node:';

exports.newInstance = function($, spec, cb) {
    try {
        $._.$.log && $._.$.log.debug('New CP plug');

        // {topic: string -> function(err, message)}
        var handlerTable = null;

        // function(topic:string, message:string)
        var handlerPubSub = null;

        var firstTimePubSub = true;

        const that = genRedisPlug.create($, spec);

        const appName = ($._.__ca_getAppName__ && $._.__ca_getAppName__()) ||
                spec.env.appName;

        assert.equal(typeof(appName), 'string',
                     "'appName' is not a string");

        const getNodeId = function() {
            return $._.$.nodes && $._.$.nodes.getNodeId() ||
                spec.env.nodeId;
        };

        assert.equal(typeof(getNodeId()), 'string',
                     "'spec.env.nodeId' is not a string");

        assert.equal(typeof(spec.env.paas), 'string',
                     "'spec.env.paas' is not a string");

        const wrapAppName = function(x) {
            if (Array.isArray(x)) {
                return x.map(wrapAppName);
            } else if (typeof x === 'string') {
                return json_rpc.joinName(appName, x);
            } else {
                return x;
            }
        };

        const doLua = function(op, ids, argsList, cb0) {
            that.__ca_doLuaOp__(op, ids, [getNodeId()].concat(argsList), cb0);
        };

        /*
          * type of newStates is Array.<{id:string, value:string}>
         *
         */
        const updateStateF = function(newStates, cb0) {
            const ids = newStates.map(x => x.id);
            const values = newStates.map(x => x.value);
            doLua('updateState', ids, values, cb0);
        };

        /**
         * Updates the state of a CA in the checkpointing service.
         *
         * @param {string} id An identifier for the CA.
         * @param {string} newValue A serialized new state for this CA.
         * @param {cbType} cb0 A callback to notify of an error updating
         * or succesful completion if falsy argument.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias updateState
         */
        that.updateState = function(id, newValue, cb0) {
            let bufValue = Buffer.from(newValue, 'utf-8');
            bufValue = spec.env.compressState ?
                utilR.compressJSON(bufValue) :
                bufValue;
            that.__ca_queue__(cb0, {id: wrapAppName(id), value: bufValue});
            that.__ca_flush__(updateStateF, false);
        };

        /**
         * Removes the state of a CA in the checkpointing service.
         *
         * @param {string} id An identifier for the CA.
         * @param {cbType} cb0 A callback to notify an error deleting
         * or its succesful completion if the argument is a falsy.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias deleteState
         */
        that.deleteState = function(id, cb0) {
            doLua('deleteState', [wrapAppName(id)], [], cb0);
        };

        /**
         * Gets the state of a  CA from the checkpointing service.
         *
         * Note that only the current (lease) owner can read this state.
         *
         *
         * @param {string} id An identifier for the CA.
         * @param {function(Object=, string=):void} cb0 A callback to notify an
         * error getting the state or (in a second argument) the serialized
         * state of that CA.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias getState
         */
        that.getState = function(id, cb0) {
            const cb1 = function(err, data) {
                if (err) {
                    cb0(err);
                } else {
                    let newState = data[0];
                    newState = Buffer.isBuffer(newState) ?
                        utilR.decompressJSON(newState).toString('utf-8') :
                        newState;
                    cb0(err, newState);
                }
            };
            doLua('getState', [Buffer.from(wrapAppName(id), 'utf-8')], [], cb1);
        };

        /**
         * Grabs a lease that guarantees exclusive ownership of a CA by this
         *  node.
         *
         * @param {string} id An identifier for the CA.
         * @param {number} leaseTimeout Duration of the lease in seconds.
         * @param {cbType} cb0 A callback with optional
         * (error) argument containing the current owner in a
         * `remoteNode:string` error field, if we failed to acquire the lease.
         * Null error argument if we succeeded.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias grabLease
         */
        that.grabLease = function(id, leaseTimeout, cb0) {
            const cb1 = function(err, remote) {
                if (err) {
                    // not owned by me due to error
                    cb0(err);
                } else {
                    if (remote && (typeof remote[0] === 'string')) {
                        // not owned by me because already owned by someone else
                        const newErr = new Error('Lease owned by someone else');
                        newErr['remoteNode'] = remote[0];
                        cb0(newErr);
                    } else {
                        // got it
                        cb0(null);
                    }
                }
            };
            doLua('grabLease', [wrapAppName(id)], [leaseTimeout], cb1);
        };

        /**
         * Renews a list of leases currently owned by this node.
         *
         * @param {Array.<string>} ids A list of identifiers for local CAs.
         * @param {number} leaseTimeout Duration of the lease in seconds.
         * @param {function(Object=, Array.<string>=):void} cb0 A callback with
         *  either an error (first) argument or a (second) argument with a list
         * of CA Ids that we failed to renew.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias renewLeases
         */
        that.renewLeases = function(ids, leaseTimeout, cb0) {
            if (ids.length > 8000) {
                const err = new Error('LUA unpack limited to 8000');
                err['length'] = ids.length;
                cb0(err);
            } else {
                doLua('renewLeases', wrapAppName(ids), [leaseTimeout], cb0);
            }
        };

        const doOneOrMany = function(x, f) {
            if (Array.isArray(x)) {
                return x.map(f);
            } else {
                return f(x);
            }
        };

        const addNodeKeyPrefix = function(x) {
            const f = function(key) {
                return NODE_KEY_PREFIX + key;
            };
            return doOneOrMany(x, f);
        };

        const removeNodeKeyPrefix = function(x) {
            const f = function(key) {
                if (key.indexOf(NODE_KEY_PREFIX) === 0) {
                    return key.split(NODE_KEY_PREFIX)[1];
                } else {
                    return key;
                }
            };
            return doOneOrMany(x, f);
        };

        /**
         * Looks up a cache entry.
         *
         * @param {string} key The cache entry key.
         * @param {cbType} cb0 A callback returning the value (or null).
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias getCache
         */
        that.getCache = function(key, cb0) {
            const cb1 = function(err, data) {
                if (err) {
                    cb0(err);
                } else {
                    cb0(err, data[0]);
                }
            };
            that.__ca_doLuaOp__('getCache', [CACHE_PREFIX + key], [], cb1);
        };

        /**
         *  Updates a cache entry.
         *
         * @param {string} key The cache entry key.
         * @param {string} value The cache entry value.
         * @param {number} timeout An expire time in seconds.
         * @param {cbType} cb0 A callback to return an error.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias updateCache
         */
        that.updateCache = function(key, value, timeout, cb0) {
            that.__ca_doLuaOp__('updateCache', [CACHE_PREFIX + key],
                                [value, timeout], cb0);
        };

        const wrapMapResponse = function(cb0) {
            return function (err, value) {
                if (err) {
                    cb0(err);
                } else {
                    try {
                        const result = {remove: [], add: [], version: 0};
                        let key = null;
                        value.forEach(function(x, i) {
                            if (i%2 === 0) {
                                key = x;
                            } else {
                                const parsedX = JSON.parse(x);
                                result.add.push(key);
                                result.add.push(parsedX);
                            }
                        });
                        cb0(err, result);
                    } catch (error) {
                        cb0(error);
                    }
                }
            };
        };

        /**
         * Sets bits in a bitfield.
         *
         * @param {string} bitfieldName The name of the bitfield.
         * @param {Array.<number>} bits The index of bits to be set.
         * @param {cbType} cb0 A callback to notify an error.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias setBits
         */
        that.setBits = function(bitfieldName, bits, cb0) {
            const newBitsKey = [BITS_PREFIX + wrapAppName(bitfieldName)];
            that.__ca_doLuaOp__('setBits', newBitsKey, bits, cb0);
        };

        /**
         * Clear all bits in a bitfield.
         *
         * @param {string} bitfieldName The name of the bitfield.
         * @param {cbType} cb0 A callback to notify an error.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias clearBits
         */
        that.clearBits = function(bitfieldName, cb0) {
            const newBitsKey = [BITS_PREFIX + wrapAppName(bitfieldName)];
            that.__ca_doLuaOp__('clearBits', newBitsKey, [], cb0);
        };

        /**
         * Check bits in a bitfield. If any is not set it returns false.
         *
         * @param {string} bitfieldName The name of the bitfield.
         * @param {Array.<number>} bits The index of bits to be checked.
         * @param {cbType} cb0 A callback to return true if all set or null
         * otherwise (or an error).
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias checkBits
         */
        that.checkBits = function(bitfieldName, bits, cb0) {
            const newBitsKey = [BITS_PREFIX + wrapAppName(bitfieldName)];
            that.__ca_doLuaOp__('checkBits', newBitsKey, bits, cb0);
        };

        /**
         * Creates a Map or returns the contents of an existing one.
         *
         * @param {string} mapName The name of the map.
         * @param {Object.<string, jsonType>|null} initialValue An optional
         * initial value. This value is ignored if the map was already
         * initialized.
         * @param {cbType} cb0 A callback with the contents of the map.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias createMap
         */
        that.createMap = function(mapName, initialValue, cb0) {
            const toAdd = ['__ca_version__', '0'];
            if (initialValue && (typeof initialValue === 'object')) {
                Object.entries(initialValue)
                    .forEach(([k, v]) => {
                        toAdd.push(k);
                        toAdd.push(JSON.stringify(v));
                    });
            }
            that.__ca_doLuaOp__('createMap', [MAP_PREFIX +
                                              wrapAppName(mapName)], toAdd,
                                wrapMapResponse(cb0));
        };

        /**
         * Deletes a Map.
         *
         * @param {string} mapName The name of the map.
         * @param {cbType} cb0 A callback with an error  or null.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias deleteMap
         */
        that.deleteMap = function(mapName, cb0) {
            that.__ca_doLuaOp__('deleteMap', [MAP_PREFIX +
                                              wrapAppName(mapName)], [], cb0);
        };


        /**
         * Reads all the contents of a map.
         *
         * @param {string} mapName The name of the map.
         * @param {cbType} cb0 A callback with an error if it does not exist or
         * an object (second argument) of type caf.changes :
         * {version:number, remove:[],
         * add:Array<Object> (i.e., flattened key value pairs)}
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias readMap
         */
        that.readMap = function(mapName, cb0) {
            that.__ca_doLuaOp__('readMap', [MAP_PREFIX + wrapAppName(mapName)],
                                [], wrapMapResponse(cb0));
        };

        /**
         * Updates a Map.
         *
         * The type changesType is a normalized update (no duplicated keys) of
         * the form:
         *
         *     {version: number, remove : Array.<string>, add : Array<Object>}
         *
         *
         * It publishes in a channel with id `mapName` the JSON-encoded
         * `changes` contents.
         *
         * @param {string} mapName The name of the map.
         * @param {changesType} changes A delta with changes.
         * @param {cbType} cb0 A callback with an error if it does not exist or
         * the number of subscribed clients.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias updateMap
         */
        that.updateMap = function(mapName, changes, cb0) {
            let args = [];
            args.push(JSON.stringify(changes.version));
            const toDelete = [];
            changes.remove.forEach(function(x) {
                toDelete.push(x);
            });
            args.push(toDelete.length);
            args = args.concat(toDelete);
            changes.add.forEach(function(x, i) {
                args.push(i%2 === 0 ? x : JSON.stringify(x));

            });
            that.__ca_doLuaOp__('updateMap', [MAP_PREFIX +
                                              wrapAppName(mapName)], args, cb0);
        };

        const wrapMapMessage = function(cb0) {
            return function (err, value) {
                if (err) {
                    cb0(err);
                } else {
                    try {
                        const result = JSON.parse(value);
                        if (!Array.isArray(result.remove)) {
                            // cjson maps [] to {}
                            result.remove = [];
                        }
                        if (!Array.isArray(result.add)) {
                            // cjson maps [] to {}
                            result.add = [];
                        }
                        let key = null;
                        const add = [];
                        result.add.forEach(function(x, i) {
                            if (i%2 === 0) {
                                key = x;
                            } else {
                                const parsedX = JSON.parse(x);
                                add.push(key);
                                add.push(parsedX);
                            }
                        });
                        result.add = add;
                        cb0(err, result);
                    } catch (error) {
                        cb0(error);
                    }
                }
            };
        };

        /**
         * Listens to Map updates.
         *
         * @param {string} mapName The name of the map.
         * @param {cbType} handler A handler to listen to updates or errors.
         * @param {cbType} cb0 A callback with an error or null.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias subscribeMap
         */
        that.subscribeMap = function(mapName, handler, cb0) {
            const mapFull = MAP_PREFIX + wrapAppName(mapName);
            if (handlerTable === null) {
                that.__ca_getClientRedis__()
                    .on('message', function(channel, message) {
                        if (channel.indexOf(MAP_PREFIX) === 0) {
                            const h = handlerTable[channel];
                            if (h) {
                                // fun (err, message)
                                h(null, message);
                            } else {
                                $._.$.log &&
                                    $._.$.log.debug('Map:No handler  for' +
                                                    message);
                            }
                        }
                    });
                handlerTable = {};
            }
            handlerTable[mapFull] = wrapMapMessage(handler);
            that.__ca_getClientRedis__().subscribe(mapFull, cb0);
        };

        /**
         * Unregisters a Map update listener.
         *
         * @param {string} mapName The name of the map.
         * @param {cbType} cb0 A callback with an error or null.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias unsubscribeMap
         */
        that.unsubscribeMap = function(mapName, cb0) {
            const mapFull = MAP_PREFIX + wrapAppName(mapName);
            delete handlerTable[mapFull];
            that.__ca_getClientRedis__().unsubscribe(mapFull, cb0);
        };

        /**
         * Clears a handler processing PubSub service messages.
         *
         * @param {function(string, string):void} deliverMsgF The original
         * handler.
         *
         */
        that.clearPubSub = function(deliverMsgF) {
            if (handlerPubSub === deliverMsgF) {
                handlerPubSub = null;
            }
        };

        const initPubSub = function() {
            const prefix = PUBSUB_PREFIX + wrapAppName('');
            that.__ca_getClientRedis__()
                .on('message', function(channel, message) {
                    if (channel.indexOf(prefix) === 0) {
                        if (handlerPubSub) {
                            // fun (topic, message)
                            handlerPubSub(channel.split(prefix)[1], message);
                        } else {
                            $._.$.log &&
                                $._.$.log.trace('PubSub:No handler  for' +
                                                message);
                        }
                    }
                });
        };

        /**
         * Subscribes to a channel in the PubSub service.
         *
         * @param {string} topic The channel name.
         * @param {function(string, string):void} deliverMsgF Handler of
         * received messages. First argument is the topic, second the message.
         * @param {cbType} cb0 A callback to return a subscription error.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias subscribePubSub
         */
        that.subscribePubSub = function(topic, deliverMsgF, cb0) {
            if (firstTimePubSub) {
                firstTimePubSub = false;
                initPubSub();
            }
            // only one handler active for all pubsub topics (single client)
            handlerPubSub = deliverMsgF;
            const topicFull = PUBSUB_PREFIX + wrapAppName(topic);
            that.__ca_getClientRedis__().subscribe(topicFull, cb0);
        };

        /**
         * Unsubscribes to a channel in the PubSub service.
         *
         * @param {string} topic The channel name.
         * @param {cbType} cb0 A callback to return a subscription error.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias unsubscribePubSub
         */
        that.unsubscribePubSub = function(topic, cb0) {
            const topicFull = PUBSUB_PREFIX + wrapAppName(topic);
            that.__ca_getClientRedis__().unsubscribe(topicFull, cb0);
        };

        /**
         * Publishes a message to a channel using the  PubSub service.
         *
         * @param {string} topic The channel name.
         * @param {string} message The message to be published.
         * @param {cbType} cb0 A callback to return a publish error.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias publishPubSub
         */
        that.publishPubSub = function(topic, message, cb0) {
            const topicFull = PUBSUB_PREFIX + wrapAppName(topic);
            that.__ca_getClientRedis__().publish(topicFull, message, cb0);
        };


        /**
         * Renews a lease associated with this node.js process.
         *
         * @param {string} privateNodeId  A private unique identifier for the
         *  current node.js process.
         * @param {number} leaseTimeout Duration of the lease in seconds.
         * @param {function(Error):void} cb0 A callback with
         * an error if we cannot renew lease.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias renewNodeLease
         */
        that.renewNodeLease = function(privateNodeId, leaseTimeout, cb0) {
            const cb1 = function(err, data) {
                if (err) {
                    cb0(err);
                } else {
                    if (Array.isArray(data) && (data.length > 0)) {
                        const error = new Error('Cannot renew node lease');
                        error['nodeId'] = removeNodeKeyPrefix(data[0]);
                        cb0(error);
                    } else {
                        cb0(null);
                    }
                }
            };
            that.__ca_doLuaOp__('renewLeases', [addNodeKeyPrefix(getNodeId())],
                                [privateNodeId, leaseTimeout], cb1);
        };

        /**
         * Picks an available public nodeId for this process and binds it with a
         * lease to the private node identifier.
         *
         *
         * @param {Array.<string>} allPublicNodeIds  A list of candidates for a
         * public nodeId for this process.
         * @param {string} privateNodeId  A private unique identifier for the
         *  current node.js process.
         * @param {number} leaseTimeout Duration of the lease in seconds.
         * @param {function(Error, string=):void} cb0 A callback with
         * an error if we cannot renew lease or the new external nodeId.
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias grabNodeLease
         */
        that.grabNodeLease = function(allPublicNodeIds, privateNodeId,
                                      leaseTimeout, cb0) {
            if (allPublicNodeIds.length > 8000) {
                const err = new Error('LUA unpack limited to 8000');
                err['length'] = allPublicNodeIds.length;
                cb0(err);
            } else {
                const cb1 = function(err, data) {
                    if (err) {
                        cb0(err);
                    } else {
                        cb0(err, removeNodeKeyPrefix(data));
                    }
                };
                that.__ca_doLuaOp__('grabNodeLease',
                                    addNodeKeyPrefix(allPublicNodeIds),
                                    [privateNodeId, leaseTimeout], cb1);
            }
        };

        /**
         * Lists status of  nodes registered with this redis instance.
         *
         * @param {Array.<string>|null} allPublicNodeIds  A list of
         * public nodeIds that we are interested on, or null if we want them
         * all.
         * @param {function(Error, Object.<string,string|null>=):void} cb0 A
         * callback with an error or an object with external nodeIds to
         *  private nodeIds (containing only the ones in use).
         *
         * @memberof! module:caf_redis/plug_checkpoint#
         * @alias listNodes
         *
         */
        that.listNodes = function(allPublicNodeIds, cb0) {
            if (!allPublicNodeIds) {
                const cb1 = function(err, data) {
                    if (err) {
                        cb0(err);
                    } else {
                        const result = {};
                        let key = null;
                        data.forEach(function(x) {
                            if (key === null) {
                                key = removeNodeKeyPrefix(x);
                            } else {
                                if (x) {
                                    result[key] = x;
                                }
                                key = null;
                            }
                        });
                        // @ts-ignore
                        cb0(err, result);
                    }
                };
                doLua('listAllNodes', [], [NODE_KEY_PREFIX+'*'], cb1);
            } else if (allPublicNodeIds.length > 8000) {
                const err = new Error('LUA unpack limited to 8000');
                err['length'] = allPublicNodeIds.length;
                cb0(err);
            } else {
                const cb2 = function(err, data) {
                    if (err) {
                        cb0(err);
                    } else {
                        const result = {};
                        data.forEach(function(x, i) {
                            if (x) {
                                result[allPublicNodeIds[i]] = x;
                            }
                        });
                        // @ts-ignore
                        cb0(err, result);
                    }
                };
                doLua('listNodes', addNodeKeyPrefix(allPublicNodeIds), [], cb2);
            }
        };

        const dynamicServiceConfig = $._.$.paas &&
                  $._.$.paas.getServiceConfig(spec.env.paas) || null;
        that.__ca_initClient__(dynamicServiceConfig, luaAll, updateStateF, cb);

    } catch (err) {
        cb(err);
    }
};
