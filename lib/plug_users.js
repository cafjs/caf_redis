'use strict';
/**
 * A plug to access a user management service backend based on Redis.
 *
 * @module caf_redis/plug_users
 * @augments module:caf_redis/gen_redis_plug
 */
// @ts-ignore: augments not attached to a class

var assert = require('assert');
var util = require('util');
var genRedisPlug = require('./gen_redis_plug');
var json_rpc = require('caf_transport').json_rpc;

const USER_PREFIX = 'user:';

const USER_MAP = USER_PREFIX + 'users';

const APP_MAP = USER_PREFIX + 'apps';

const CAS_MAP = USER_PREFIX + 'cas';

const NONCE_MAP = USER_PREFIX + 'nonces';

const APPS_SET_PREFIX = USER_PREFIX + 'appsSet';

const CAS_SET_PREFIX = USER_PREFIX + 'casSet';

/*
 * Creates a new user with default units. Does nothing if user already exists.
 *
 * KEYS users map name
 * ARGV[1] user
 * ARGV[2] default units
 *
 */
/*eslint-disable */
var luaCreateUser =
'if redis.call("hexists", KEYS[1], ARGV[1]) == 0 then \
   redis.call("hset", KEYS[1], unpack(ARGV)) \
 end ';
/*eslint-enable*/

/*
 * Creates a new app. Does nothing if user already exists.
 *
 * KEYS[1] apps set for this user
 * KEYS[2] app map name
 * ARGV[1] app name
 * ARGV[2] default time in seconds per cost unit
 *
 */
/*eslint-disable */
var luaCreateApp =
'if redis.call("hexists", KEYS[2], ARGV[1]) == 0 then \
   redis.call("sadd", KEYS[1], ARGV[1]) \
   redis.call("hset", KEYS[2], unpack(ARGV)) \
 end ';
/*eslint-enable*/

/*
 * Creates a new CA.
 *
 * If CA already exists and it has not expired, it does nothing.
 *
 * Otherwise, it calculates the time per cost unit and updates:
 *     1) owner and app writer balance.
 *     2) New termination time.
 *     3) Set of CAs for the owner (if needed)
 *
 * Missing app or not enough balance returns error.
 *
 * KEYS[1] user map name
 * KEYS[2] app map name
 * KEYS[3] CA map name
 * KEYS[4] CAs set for this user
 * ARGV[1] App writer name
 * ARGV[2] CA owner
 * ARGV[3] ca identifier
 * ARGV[4] units to add to app writer
 * ARGV[5] current time
 * ARGV[6] App name
 *
 */
/*eslint-disable */
var luaCreateCA =
'local expireTime = redis.call("hget", KEYS[3], ARGV[3]) \
if not expireTime or tonumber(expireTime) < tonumber(ARGV[5]) then \
 local extraTime = redis.call("hget", KEYS[2], ARGV[6]) \
 if not extraTime then \
     return { err = "App does not exist."} \
 else \
   local ownerBalance = redis.call("hget", KEYS[1], ARGV[2]) \
   ownerBalance = tonumber(ownerBalance) \
   if not ownerBalance or (ownerBalance < 1) then \
     return { err = "User does not have enough balance."} \
   else \
     redis.call("hincrbyfloat", KEYS[1], ARGV[2], "-1.0") \
     redis.call("hincrbyfloat", KEYS[1], ARGV[1], ARGV[4]) \
     local newExpireTime =  tonumber(ARGV[5]) + tonumber(extraTime) \
     redis.call("hset", KEYS[3], ARGV[3], tostring(newExpireTime)) \
     redis.call("sadd", KEYS[4], ARGV[3]) \
     return newExpireTime \
   end \
 end \
else \
  return expireTime \
end ';
/*eslint-enable*/

/*
 * Adds units to a user. If nonce is not fresh, it ignores request.
 *
 * KEYS[1] nonce name
 * KEYS[2] users map name
 * ARGV[1] nonce
 * ARGV[2] user
 * ARGV[3] extra units
 *
 */
/*eslint-disable */
var luaAddUnits =
'local nonce = redis.call("hget", KEYS[1], ARGV[2]) \
 if nonce ~= ARGV[1] then \
    redis.call("hset", KEYS[1], ARGV[2], ARGV[1]) \
    redis.call("hincrbyfloat", KEYS[2], ARGV[2], ARGV[3]) \
 end ';
/*eslint-enable*/

/*
 * Removes units from a user. If nonce is not fresh, it ignores request.
 *
 * If there are not enough units, it returns an error without changing the
 * balance.
 * KEYS[1] nonce name
 * KEYS[2] users map name
 * ARGV[1] nonce
 * ARGV[2] user
 * ARGV[3] units to remove
 *
 */
/*eslint-disable */
var luaRemoveUnits =
'local nonce = redis.call("hget", KEYS[1], ARGV[2]) \
 if nonce ~= ARGV[1] then \
    redis.call("hset", KEYS[1], ARGV[2], ARGV[1]) \
    local balance = redis.call("hget", KEYS[2], ARGV[2]) \
    if not balance then \
        return { err = "User does not exist."} \
    elseif tonumber(balance) < tonumber(ARGV[3]) then \
        return { err = "Not enough balance."} \
    else \
        return redis.call("hincrbyfloat", KEYS[2], ARGV[2], "-" .. ARGV[3]) \
    end \
 end ';
/*eslint-enable*/

/*
 * List users
 *
 * KEYS[1] users map name
 *
 */
var luaListUsers = 'return redis.call("hkeys", KEYS[1])';

/*
 * List apps for a user
 *
 * KEYS[1] name of user app set
 *
 */
var luaListApps = 'return redis.call("smembers", KEYS[1])';

/*
 * Describe a user
 *
 * KEYS[1] name of use map
 * ARGV[1] user
 *
 */
var luaDescribeUser = 'return redis.call("hget", KEYS[1], ARGV[1])';

var luaAll = {
    createUser: luaCreateUser,
    createApp: luaCreateApp,
    createCA: luaCreateCA,
    addUnits: luaAddUnits,
    removeUnits: luaRemoveUnits,
    listUsers: luaListUsers,
    listApps: luaListApps,
    listCAs: luaListApps, // same implementation, different key
    describeUser: luaDescribeUser,
    describeApp: luaDescribeUser, // same implementation, different key
    describeCA: luaDescribeUser // same implementation, different key

};

exports.newInstance = async function($, spec) {
    try {
        $._.$.log && $._.$.log.debug('New Users plug');

        var that = genRedisPlug.constructor($, spec);

        var appName = ($._.__ca_getAppName__ && $._.__ca_getAppName__()) ||
                spec.env.appName;

        assert.equal(typeof(appName), 'string',
                     "'appName' is not a string");

        var userMap = json_rpc.joinName(USER_MAP, appName);
        var appMap = json_rpc.joinName(APP_MAP, appName);
        var casMap = json_rpc.joinName(CAS_MAP, appName);
        var nonceMap = json_rpc.joinName(NONCE_MAP, appName);
        var appsSetPrefix = json_rpc.joinName(APPS_SET_PREFIX, appName) + ':';
        var casSetPrefix = json_rpc.joinName(CAS_SET_PREFIX, appName) + ':';


        assert.equal(typeof(spec.env.defaultUnits), 'number',
                     "'spec.env.defaultUnits' is not a number");
        var defaultUnits = spec.env.defaultUnits;

        assert.equal(typeof(spec.env.defaultTimePerUnit), 'number',
                     "'spec.env.defaultTimePerUnit' is not a number");
        var defaultTimePerUnit = spec.env.defaultTimePerUnit;

        assert.equal(typeof(spec.env.appWriterFraction), 'number',
                     "'spec.env.appWriterFraction' is not a number");
        var appWriterFraction = spec.env.appWriterFraction;

        var doLuaAsync = util.promisify(that.__ca_doLuaOp__);
        var initClientAsync = util.promisify(that.__ca_initClient__);

        that.createUser = function(user) {
            return doLuaAsync('createUser', [userMap], [user, defaultUnits]);
        };

        that.createApp = function(app, cost) {
            var user = json_rpc.splitName(app)[0];
            return doLuaAsync('createApp', [appsSetPrefix+user, appMap],
                              [app, cost || defaultTimePerUnit]);
        };

        that.createCA = function(ca) {
            var splitCA = json_rpc.splitName(ca);
            var appWriter = splitCA[0];
            var user = splitCA[2];
            var app = json_rpc.joinName(splitCA[0], splitCA[1]);
            var time = Math.floor((new Date()).getTime()/1000);

            return doLuaAsync('createCA', [
                userMap, appMap, casMap, casSetPrefix + user
            ], [appWriter, user, ca, appWriterFraction, time, app]);
        };

        that.addUnits = function(nonce, user, units) {
            return doLuaAsync('addUnits', [nonceMap, userMap],
                              [nonce, user, units]);
        };

        that.removeUnits = function(nonce, user, units) {
            return doLuaAsync('removeUnits', [nonceMap, userMap],
                              [nonce, user, units]);
        };

        that.listUsers = function() {
            return doLuaAsync('listUsers', [userMap], []);
        };

        that.listApps = function(user) {
            return doLuaAsync('listApps', [appsSetPrefix + user], []);
        };

        that.listCAs = function(user) {
            return doLuaAsync('listCAs', [casSetPrefix + user], []);
        };

        that.describeUser = function(user) {
            return doLuaAsync('describeUser', [userMap], [user]);
        };

        that.describeApp = function(app) {
            return doLuaAsync('describeApp', [appMap], [app]);
        };

        that.describeCA = function(ca) {
            return doLuaAsync('describeCA', [casMap], [ca]);
        };

        var dynamicServiceConfig = $._.$.paas &&
            $._.$.paas.getServiceConfig(spec.env.paas) || null;
        await initClientAsync(dynamicServiceConfig, luaAll, null);

        return [null, that];
    } catch (err) {
        return [err];
    }
};
