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
        var uuid = Math.floor(Math.random() *10000000000000000);
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

        that.grabLease = function(cb0) {
            $._.$.cp.grabLease(uuid, spec.env.leaseTimeout, cb0);
        };

        that.renewLease = function(cb0) {
            $._.$.cp.renewLeases([uuid], spec.env.leaseTimeout, cb0);
        };

        that.updateState = function(cb0) {
            counter = counter + 1;
            $._.$.cp.updateState(uuid, JSON.stringify(that.readLocalState()),
                                 cb0);
        };

        that.deleteState = function(cb0) {
            $._.$.cp.deleteState(uuid, cb0);
        };

        that.getState = function(cb0) {
            $._.$.cp.getState(uuid, cb0);
        };

        cb(null, that);
    } catch (err) {
        console.log('got err' + err);
        cb(err);
    }
};
