'use strict';
const lzo = require('lzo');

const MAX_COMPRESSION_RATIO = 20;

/**
 * Helper functions for redis
 *
 *
 * @name caf_redis/util_builder
 * @namespace
 *
 */


exports.compressJSON = function(buf) {
    return lzo.compress(buf);
};

const isCompressedJSON = function(buf) {
    if (Buffer.isBuffer(buf)) {
        try {
            JSON.parse(buf.toString('utf-8'));
            return false;
        } catch (err) {
            return true;
        }
    } else {
        return false;
    }
};

exports.isCompressedJSON = isCompressedJSON;

exports.decompressJSON = function(buf) {
    return isCompressedJSON(buf) ?
        lzo.decompress(buf, buf.length * MAX_COMPRESSION_RATIO):
        buf;
};
