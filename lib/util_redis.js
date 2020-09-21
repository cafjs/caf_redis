'use strict';
const lzo = require('lzo');

const MAX_COMPRESSION_RATIO = 20;
const MIN_BUFFER_SIZE = 1000000;

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
        // very small buffers may have very large compression ratios
        lzo.decompress(buf, Math.max(buf.length * MAX_COMPRESSION_RATIO,
                                     MIN_BUFFER_SIZE)):
        buf;
};
