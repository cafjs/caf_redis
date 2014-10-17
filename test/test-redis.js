var async = require('async');
var hello = require('./hello/main.js');

exports.helloworld = function (test) {
    test.expect(6);
    var context;
    var state0;
    async.series([
                     function(cb) {
                         hello.load(null, null, 'hello1.json', null,
                                    function(err, $) {
                                        context = $;
                                        console.log("Hello");
                                        test.ifError(err);
                                        test.equal(typeof($.topRedis), 'object',
                                                   'Cannot create hello');
                                        cb(err, $);
                                    });
                     },
                     function(cb) {
                         console.log('-1> ');
                         state0 = context._.$.h2.readLocalState();
                         state0 = {counter: state0.counter};
                         console.log('0> ' + JSON.stringify(state0));
                         context._.$.h2.grabLease(cb);
                     },
                     function(cb) {
                         context._.$.h2.updateState(cb);
                     },
                     function(cb) {
                         context._.$.h2.updateState(cb);
                     },
                     function(cb) {
                         context._.$.h2.updateState(cb);
                     },
                     function(cb) {
                         var cb1 = function(err, data) {
                             test.ifError(err);
                             var state = context._.$.h2.readLocalState();
                             test.equal(state.counter, state0.counter +3,
                                        'Counter not incremented');
                             var cpState = JSON.parse(data);
                              test.equal(state.counter, cpState.counter,
                                        'State CP not incremented');
                             cb(err, data);
                         };
                         context._.$.h2.getState(cb1);
                     },

                     function(cb) {
                       context.topRedis.__ca_shutdown__(null, cb);

                     }
                 ], function(err, data) {
                     test.ifError(err);
                     test.done();
                 });

};

exports.nolease = function(test) {

    test.expect(3);
    var context;
    async.series([
                     function(cb) {
                         hello.load(null, null, 'hello1.json', null,
                                    function(err, $) {
                                        context = $;
                                        test.ifError(err);
                                        test.equal(typeof($.topRedis), 'object',
                                                   'Cannot create hello');
                                        cb(err, $);
                                    });
                     },
                     function(cb) {
                         context._.$.h2.updateState(cb);
                     }
                 ], function(err, data) {
                     test.ok(err && (typeof err === 'object'),
                             "No error with update without lease");
                     var cb = function() {
                         test.done();
                     };
                     context.topRedis.__ca_shutdown__(null, cb);
                 });

};
