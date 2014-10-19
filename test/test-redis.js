var async = require('async');
var hello = require('./hello/main.js');

module.exports = {
    setUp: function (cb) {
        var self = this;
        hello.load(null, null, 'hello1.json', null,
                   function(err, $) {
                       self.$ = $;
//                       test.ifError(err);
//                       test.equal(typeof($.topRedis), 'object',
//                                  'Cannot create hello');

                       cb(err, $);
                   });
    },
    tearDown: function (cb) {
        this.$.topRedis.__ca_shutdown__(null, cb);
    },
    helloworld: function (test) {
        var self = this;
        test.expect(4);
        var state0;
        async.series([
                         function(cb) {
                             state0 = self.$._.$.h2.readLocalState();
                             state0 = {counter: state0.counter};
                             self.$._.$.h2.grabLease(cb);
                         },
                         function(cb) {
                             self.$._.$.h2.updateState(cb);
                         },
                         function(cb) {
                             self.$._.$.h2.updateState(cb);
                         },
                         function(cb) {
                             self.$._.$.h2.updateState(cb);
                         },
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.ifError(err);
                                 var state = self.$._.$.h2.readLocalState();
                                 test.equal(state.counter, state0.counter +3,
                                            'Counter not incremented');
                                 var cpState = JSON.parse(data);
                                 test.equal(state.counter, cpState.counter,
                                            'State CP not incremented');
                                 cb(err, data);
                             };
                             self.$._.$.h2.getState(cb1);
                         }
                     ], function(err, data) {
                         test.ifError(err);
                         test.done();
                     });

    },

    nolease: function(test) {
        var self = this;
        test.expect(1);
        async.series([
                         function(cb) {
                             self.$._.$.h2.updateState(cb);
                         }
                     ], function(err, data) {
                         test.ok(err && (typeof err === 'object'),
                                 "No error with update without lease");
                         test.done();
                     });
    },

    delete: function(test) {
        var self = this;
        test.expect(2);
        async.series([
                         function(cb) {
                             self.$._.$.h2.grabLease(cb);
                         },
                         function(cb) {
                             self.$._.$.h2.updateState(cb);
                         },
                         function(cb) {
                             self.$._.$.h2.deleteState(cb);
                         },
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.equal(data, null,
                                            'Deleted key has value ' +
                                            data);
                                 cb(err, data);
                             };
                             self.$._.$.h2.getState(cb1);
                         },
                         function(cb) {
                             // no op
                             self.$._.$.h2.deleteState(cb);
                         }
                     ], function(err, data) {
                         test.ifError(err);
                         test.done();
                     });
    },

    expireLease: function(test) {
        var self = this;
        test.expect(4);
        async.series([
                         function(cb) {
                             self.$._.$.h2.grabLease(cb);
                         },
                         function(cb) {
                             setTimeout(function() { cb(null); }, 1500);
                         },
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.ok(err && (typeof err === 'object'),
                                         "No error with update without lease");
                                 cb(null);
                             };
                             self.$._.$.h2.getState(cb1);
                         },
                         function(cb) {
                             self.$._.$.h2.grabLease(cb);
                         },
                         function(cb) {
                             self.$._.$.h2.updateState(cb);
                         },
                         function(cb) {
                             setTimeout(function() { cb(null); }, 750);
                         },
                         function(cb) {
                             self.$._.$.h2.renewLease(cb);
                         },
                         function(cb) {
                             setTimeout(function() { cb(null); }, 750);
                         },
                         function(cb) {
                             self.$._.$.h2.renewLease(cb);
                         },
                         function(cb) {
                             setTimeout(function() { cb(null); }, 750);
                         },
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.ifError(err);
                                 var state = self.$._.$.h2.readLocalState();
                                 console.log('state: ' + JSON.stringify(state));
                                 console.log('cp: ' + JSON.stringify(data));
                                 var cpState = JSON.parse(data);

                                 test.equal(state.counter, cpState.counter,
                                            'State CP lost');
                                 cb(null);
                             };
                             self.$._.$.h2.getState(cb1);
                         }
                     ], function(err, data) {
                         test.ifError(err);
                         test.done();
                     });
    },
    bulk: function(test) {
        var self = this;
        var all = ['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
        test.expect(28);
        async.series([
                         function(cb) {
                             async.map(all, function(x, cb0) {
                                           self.$._.$[x].grabLease(cb0);
                                       }, cb);
                         },
                         function(cb) {
                             async.map(all, function(x, cb0) {
                                           self.$._.$[x].updateState(cb0);
                                       }, cb);
                         },
                         function(cb) {
                             async.map(all, function(x, cb0) {
                                           self.$._.$[x].updateState(cb0);
                                       }, cb);
                         },
                         function(cb) {
                             async.map(all, function(x, cb0) {
                                           var cb1 = function(err, data) {
                                               test.ifError(err);
                                               var state = self.$._.$[x]
                                                   .readLocalState();
                                               var cpState = JSON.parse(data);
                                               test.equal(state.counter,
                                                          cpState.counter,
                                                          'State CP lost');
                                               cb0(null);
                                           };
                                           self.$._.$[x].getState(cb1);
                                       }, cb);
                         },
                         function(cb) {
                             async.map(all, function(x, cb0) {
                                           self.$._.$[x].deleteState(cb0);
                                       }, cb);
                         },
                        function(cb) {
                             async.map(all, function(x, cb0) {
                                           var cb1 = function(err, data) {
                                               test.equal(data, null,
                                                          'Deleted key exists' +
                                                          data);
                                               cb0(err, data);
                                           };
                                           self.$._.$[x].getState(cb1);
                                       }, cb);
                         }
                     ], function(err, data) {
                         test.ifError(err);
                         test.done();
                     });
    },
    twoPlugs: function(test) {
        var self = this;
        test.expect(6);
        async.series([
                         function(cb) {
                             self.$.topRedis.__ca_shutdown__(null, cb);
                         },
                         function(cb) {
                             hello.load(null, null, 'hello2.json', null,
                                        function(err, $) {
                                            self.$ = $;
                                            test.ifError(err);
                                            test.equal(typeof($.topRedis),
                                                       'object',
                                                       'Cannot create hello');
                                            cb(err, $);
                                        });
                         },
                         function(cb) {
                            self.$._.$.h2.grabLease('cp', cb);
                         },
                         function(cb) {
                             self.$._.$.h2.updateState('cp', cb);
                         },
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.ok(err && (typeof err === 'object'),
                                         "No error with update with bad lease");
                                 cb(null);
                             };
                             self.$._.$.h2.updateState('cp2', cb1);
                         },
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.ok(err && (typeof err === 'object'),
                                         "No error stealing lease");
                                 test.equal(typeof err.remoteNode, 'string',
                                            'No remote node');
                                 cb(null);
                             };
                             self.$._.$.h2.grabLease('cp2', cb1);
                         },
                         function(cb) {
                             setTimeout(function() { cb(null); }, 1500);
                         },
                         function(cb) {
                             self.$._.$.h2.grabLease('cp2', cb);
                         },
                         function(cb) {
                             self.$._.$.h2.updateState('cp2', cb);
                         }
                     ], function(err, data) {
                         test.ifError(err);
                         test.done();
                     });
    },
    bulkTwoPlugs: function(test) {
        var self = this;
        var all = ['h2','h3'];
        test.expect(10);
        async.series([
                         function(cb) {
                             self.$.topRedis.__ca_shutdown__(null, cb);
                         },
                         function(cb) {
                             hello.load(null, null, 'hello2.json', null,
                                        function(err, $) {
                                            self.$ = $;
                                            test.ifError(err);
                                            test.equal(typeof($.topRedis),
                                                       'object',
                                                       'Cannot create hello');
                                            cb(err, $);
                                        });
                         },
                         function(cb) {
                            self.$._.$.h2.grabLease('cp', cb);
                         },
                         function(cb) {
                            self.$._.$.h3.grabLease('cp2', cb);
                         },
                         function(cb) {
                             async.map(all, function(x, cb0) {
                                           if (x === 'h2') {
                                               self.$._.$[x]
                                                   .updateState('cp', cb0);
                                           } else {
                                               var cb1 = function(err) {
                                                   var t = err &&
                                                       (typeof err ==='object');
                                                   test.ok(t, "No update err");
                                                   cb0(null);
                                               };
                                              self.$._.$[x]
                                                   .updateState('cp', cb1);
                                           }
                                       }, cb);
                         },
                         function(cb) {
                             async.map(all, function(x, cb0) {
                                           if (x === 'h2') {
                                               self.$._.$[x]
                                                   .updateState('cp', cb0);
                                           } else {
                                               self.$._.$[x]
                                                   .updateState('cp2', cb0);
                                           }
                                       }, cb);
                         },
                         function(cb) {
                            var cb0 = function(err, data) {
                                 test.ifError(err);
                                 var state = self.$._.$.h2.readLocalState();
                                 test.equal(state.counter, 2,
                                            'h2 counter not incremented');
                                 var cpState = JSON.parse(data);
                                 test.equal(state.counter, cpState.counter,
                                            'State CP not incremented');
                                 cb(err, data);
                             };
                             self.$._.$.h2.getState('cp', cb0);
                         },
                         function(cb) {
                            var cb0 = function(err, data) {
                                 test.ifError(err);
                                 var state = self.$._.$.h3.readLocalState();
                                 test.equal(state.counter, 1,
                                            'h3 counter not incremented');
                                 var cpState = JSON.parse(data);
                                 test.equal(state.counter, cpState.counter,
                                            'State CP not incremented');
                                 cb(err, data);
                             };
                             self.$._.$.h3.getState('cp2', cb0);
                         }
                     ], function(err, data) {
                         test.ifError(err);
                         test.done();
                     });
    }
};
