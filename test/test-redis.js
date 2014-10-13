var async = require('async');
var hello = require('./hello/main.js');

exports.helloworld = function (test) {
    test.expect(3);
    var context;
    async.series([
                     function(cb) {
                         hello.load(null, null, 'hello1.json', null,
                                    function(err, $) {
                                        context = $;
                                        console.log("Hello");
                                        test.ifError(err);
                                        test.equal(typeof($.topRedis), 'object',
                                                   'Cannot create hello');
                                        //                      test.equal($.hello.getMessage(), "hola mundo");
                                        cb(err, $);
                                    });
                     },
                     function(cb) {
 console.log("shutdown");
                       context.topRedis.__ca_shutdown__(null, cb);

                     }
                 ], function(err, data) {
console.log("done");
                     test.ifError(err);
                     test.done();
                 });

};
