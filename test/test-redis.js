var async = require('async');
var hello = require('./hello/main.js');

module.exports = {
    setUp: function (cb) {
        var self = this;
        this.foo = 'bar';
        hello.load(null, null, 'hello1.json', null,
                   function(err, $) {
                       self.$ = $;
                       console.log("Hello");
//                       test.ifError(err);
                       console.log('--> ');
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
                             console.log('-1> ');
                             state0 = self.$._.$.h2.readLocalState();
                             state0 = {counter: state0.counter};
                             console.log('0> ' + JSON.stringify(state0));
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
                                 test.equal(data, null, 'Deleted key has value ' +
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
        test.expect(19);
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
                         }
                     ], function(err, data) {
                         test.ifError(err);
                         test.done();
                     });
    }

};
