var async = require('async');
var hello = require('./hello/main.js');
var caf_comp = require('caf_components');
var myUtils = caf_comp.myUtils;

var MAP1 = 'owner-ca1-map1';

process.on('uncaughtException', function (err) {
    console.log("Uncaught Exception: " + err);
    console.log(err.stack);
    //console.log(myUtils.errToPrettyStr(err));
    process.exit(1);

});


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
    },
    nodeLease: function(test) {
        var all = [
            "sasdasd.vcap.me:4000",
            "sasdasd.vcap.me:4001",
            "sasdasd.vcap.me:4002",
            "sasdasd.vcap.me:4003",
            "sasdasd.vcap.me:4004",
            "sasdasd.vcap.me:4005"
        ];
        var localNodeId = {
            "sasdasd.vcap.me:4000": "localhost:3000",
            "sasdasd.vcap.me:4001": "localhost:3001",
            "sasdasd.vcap.me:4002": "localhost:3002",
            "sasdasd.vcap.me:4003": "localhost:3003",
            "sasdasd.vcap.me:4004": "localhost:3004",
            "sasdasd.vcap.me:4005": "localhost:3005"
        };
        var oneLocalNodeId = localNodeId["sasdasd.vcap.me:4000"];
        var self = this;
        var aliases = [];
        test.expect(10);
        async.series([
                         function(cb) {
                             async.map(all, function(x, cb0) {
                                           var cb1 = function(err, data) {
                                               aliases.push(data);
                                               cb0(err, data);
                                           };
                                           self.$._.$.cp
                                               .grabNodeLease(all,
                                                              localNodeId[x], 1,
                                                              cb1);
                                       }, cb);
                         },
                         function(cb) {
                             var cb0 = function(err, data) {
                                 test.ifError(err);
                                 var keys = Object
                                     .keys(data)
                                     .filter(function(x) {
                                                 return (data[x] !== null);
                                             });
                                 test.equal(keys.length, all.length);
                                 test.deepEqual(keys.sort(), aliases.sort());
                                 cb(err, data);
                             };
                             self.$._.$.cp.listNodes(null, cb0);
//                             self.$._.$.cp.listNodes(all, cb0);
                         },
                         function(cb) {
                             var cb0 = function(err, data) {
                                 test.equal(typeof(err), 'object');
                                 test.ok(err !== null);
                                 cb(null);
                             };
                             // this one fails
                             self.$._.$.cp.grabNodeLease(all,  'foo:76',
                                                         1, cb0);
                         },
                         function(cb) {
                             var cb0 = function(err, data) {
                                 // expire all but this one
                                 setTimeout(function() {
                                                cb(err, data);
                                            }, 1500);
                             };
                             self.$._.$.cp.renewNodeLease(oneLocalNodeId, 10,
                                                          cb0);
                         },
                         function(cb) {
                             var cb0 = function(err, data) {
                                 test.ifError(err);
                                 test.equals(Object.keys(data).length, 1);
                                 var keys = Object
                                     .keys(data)
                                     .filter(function(x) {
                                                 return (data[x] !== null);
                                             });
                                 test.equal(keys.length, 1);
                                 test.deepEqual(keys.sort(),
                                                ['sasdasd.vcap.me:4000']);
                                 cb(err, data);
                             };
                             self.$._.$.cp.listNodes(all, cb0);
                         }
                     ], function(err, data) {
                         test.ifError(err);
                         test.done();
                     });
    },
    cache : function(test) {
        var self = this;
        test.expect(9);
        async.series([
                         function(cb) {
                              self.$._.$.cp.updateCache('key1', 'foo', 1, cb);
                         },
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.ifError(err);
                                 test.equal(data, 'foo');
                                 cb(err, data);
                             };
                             self.$._.$.cp.getCache('key1', cb1);
                         },
                         // expire entry
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.ifError(err);
                                 test.equal(data, null);
                                 cb(err, data);
                             };
                             setTimeout(function() {
                                            self.$._.$.cp.getCache('key1', cb1);
                                        }, 1500);
                         },
                         // overwrite
                         function(cb) {
                              self.$._.$.cp.updateCache('key1', 'foo2', 1, cb);
                         },
                         function(cb) {
                              self.$._.$.cp.updateCache('key1', 'foo3', 1, cb);
                         },
                         function(cb) {
                              self.$._.$.cp.updateCache('key2', 'bar', 1, cb);
                         },
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.ifError(err);
                                 test.equal(data, 'foo3');
                                 cb(err, data);
                             };
                             self.$._.$.cp.getCache('key1', cb1);
                         },
                         function(cb) {
                             var cb1 = function(err, data) {
                                 test.ifError(err);
                                 test.equal(data, 'bar');
                                 cb(err, data);
                             };
                             self.$._.$.cp.getCache('key2', cb1);
                         }
                     ], function(err, data) {
                         test.ifError(err);
                         test.done();
                     });

    },
    map : function(test) {
        var self = this;
        test.expect(19);
        var changes1 = {version: 0, remove:[], add: ['foo', {a:1},
                                                        'bar', true,
                                                        '__ca_version__', 1]};
        var changes3 = {version: 1, remove:['bar'],
                        add: ['foo', {a:2}, '__ca_version__', 2]};
        var changes4 = {version: 0, remove:[], add:
                        ['foo', {a:2}, '__ca_version__', 2] };

        var compareMap = function(actual, expected) {
            test.equal(actual.version, expected.version);
            test.deepEqual(actual.remove, expected.remove);
            var toObj = function(x) {
                var result = {};
                var key = null;
                x.forEach(function(a, i) {
                    if (i%2 === 0) {
                        key = a;
                    } else {
                        result[key] = a;
                    }
                });
                return result;
            };
            test.deepEqual(toObj(actual.add), toObj(expected.add));
        };

        var count = 0;
        var handler1 = function(err, data) {
            console.log(data);
            if (count === 0) {
                compareMap(data, changes1);
            } else if (count === 1) {
                compareMap(data, changes3);
            }
            count = count + 1;
        };

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
                self.$._.$.cp.createMap(MAP1, cb);
            },
            function(cb) {
                self.$._.$.cp2.subscribeMap(MAP1, handler1, cb);
            },

            function(cb) {
                self.$._.$.cp.updateMap(MAP1, changes1, cb);
            },
            function(cb) {
                var changes2 = {version: 0, remove:[], add: changes1.add};
                var cb1 = function(err, data) {
                    compareMap(data, changes2);
                    cb(err, data);
                };
                self.$._.$.cp.readMap(MAP1,  cb1);
            },
            function(cb) {
                self.$._.$.cp.updateMap(MAP1, changes3, cb);
            },
            function(cb) {
                var cb1 = function(err, data) {
                    compareMap(data, changes4);
                    cb(err, data);
                };
                self.$._.$.cp.readMap(MAP1,  cb1);
            },
            function(cb) {
                setTimeout(function() {
                    self.$._.$.cp2.unsubscribeMap(MAP1, cb);
                }, 1000);
            },
            function(cb) {
                var cb1 = function(err, data) {
                    compareMap(data, changes4);
                    cb(err, data);
                };
                self.$._.$.cp.createMap(MAP1, cb1);
            },

            function(cb) {
                self.$._.$.cp.deleteMap(MAP1, cb);
            },
            function(cb) {
                var cb1 = function(err, data) {
                    test.ok(err);
                    console.log(err);
                    cb(null, data);
                };
                self.$._.$.cp.readMap(MAP1,  cb1);
            }
        ], function(err, data) {
            test.ifError(err);
            test.done();
        });
    }
};
