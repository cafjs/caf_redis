var caf_comp = require('caf_components');

var genComponent =  caf_comp.gen_component;


/**
 * Factory method to create a test component.
 *
 * @see supervisor
 */
exports.newInstance = function($, spec, cb) {
    try {
        var that = genComponent.constructor($, spec);
        var uuid = '' + Math.floor(Math.random() *10000000000000000);
        var counter = 0;
        var state = {message: spec.env.message,
                     number: spec.env.number,
                     uuid: uuid};

        that.readLocalState = function() {
            state.counter = counter;
            return state;
        };

        that.getMessage = function() {
            return spec.env.message;
        };

        that.getNumber = function() {
            return spec.env.number;
        };


        that.getUUID = function() {
            return uuid;
        };

        that.grabLease = function(cp, cb0) {
            if ((typeof cp === 'function') && (cb0 === undefined)) {
                cb0 = cp;
                cp = 'cp';
            }
            $._.$[cp].grabLease(uuid, spec.env.leaseTimeout, cb0);
        };

        that.renewLease = function(cp, cb0) {
            if ((typeof cp === 'function') && (cb0 === undefined)) {
                cb0 = cp;
                cp = 'cp';
            }
            $._.$[cp].renewLeases([uuid], spec.env.leaseTimeout, cb0);
        };

        that.updateState = function(cp, cb0) {
            if ((typeof cp === 'function') && (cb0 === undefined)) {
                cb0 = cp;
                cp = 'cp';
            }
            counter = counter + 1;
            var cb1 = function(err, data) {
                if (err) {
                    counter = counter - 1;
                }
                cb0(err, data);
            };
            $._.$[cp].updateState(uuid, JSON.stringify(that.readLocalState()),
                                  cb1);
        };

        that.deleteState = function(cp, cb0) {
            if ((typeof cp === 'function') && (cb0 === undefined)) {
                cb0 = cp;
                cp = 'cp';
            }
            $._.$[cp].deleteState(uuid, cb0);
        };

        that.getState = function(cp, cb0) {
            if ((typeof cp === 'function') && (cb0 === undefined)) {
                cb0 = cp;
                cp = 'cp';
            }
            $._.$[cp].getState(uuid, cb0);
        };

        cb(null, that);
    } catch (err) {
        console.log('got err' + err);
        cb(err);
    }
};
