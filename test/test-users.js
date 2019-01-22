var hello = require('./hello/main.js');
var caf_comp = require('caf_components');
var async = caf_comp.async;
var myUtils = caf_comp.myUtils;
var util = require('util');

process.on('uncaughtException', function (err) {
    console.log("Uncaught Exception: " + err);
    console.log(err.stack);
    //console.log(myUtils.errToPrettyStr(err));
    process.exit(1);

});

var setTimeoutAsync = util.promisify(setTimeout);

var USERS = ['john', 'alice', 'bob'];
var APPS = ['john-play1', 'alice-play2'];
var CAS = ['john-play1-bob-x1', 'alice-play2-bob-x2',
           'john-play1-alice-x1', 'alice-play2-alice-x2'];

var appName = 'foo-test' + myUtils.uniqueId();

module.exports = {
    setUp: function (cb) {
        var self = this;
        hello.load(null, {env : {appName: appName}}, 'helloUsers.json', null,
                   function(err, $) {
                       self.$ = $;
                       cb(err, $);
                   });
    },

    tearDown: function (cb) {
        this.$.topRedis.__ca_shutdown__(null, cb);
    },

    helloworld: async function (test) {
        var self = this;
        test.expect(13);
        try {
            await this.$._.$.users.init(USERS, APPS);
            var listAll = await this.$._.$.users.listAll();
            console.log(JSON.stringify(listAll[1]));

            test.ok(Object.keys(listAll[1]).length === 3);
            test.ok(listAll[1].alice.apps.length === 1);
            test.ok(listAll[1].john.apps.length === 1);
            test.ok(listAll[1].bob.apps.length === 0);

            // vanilla create
            var res = await this.$._.$.users.createCAs(CAS);
            console.log(JSON.stringify(res));
            var describeAll = await this.$._.$.users.describeAll();
            console.log(JSON.stringify(describeAll[1]));
            test.ok(describeAll[1].users.john === "2.66");
            test.ok(describeAll[1].users.alice === "0.66");
            test.ok(describeAll[1].users.bob === "0");

            // Does not create new ones if not expired
            await this.$._.$.users.createCAs(['john-play1-bob-x1']);
            describeAll = await this.$._.$.users.describeAll();
            console.log(JSON.stringify(describeAll[1]));
            test.ok(describeAll[1].users.john === "2.66");
            test.ok(describeAll[1].users.bob === "0");

            // but it does when it expires
            await setTimeoutAsync(16000);
            res = await this.$._.$.users.createCAs(['john-play1-bob-x1']);
            console.log(JSON.stringify(res));
            test.ok(res[0]); // not enough units
            describeAll = await this.$._.$.users.describeAll();
            console.log(JSON.stringify(describeAll[1]));

            // let's add units
            await this.$._.$.users.changeUnits('23233', 'bob', 1.0);
            describeAll = await this.$._.$.users.describeAll();
            console.log(JSON.stringify(describeAll));
            test.ok(describeAll[1].users.bob === "1");

            // let's try again with enough units
            res = await this.$._.$.users.createCAs(['john-play1-bob-x1']);
            console.log(JSON.stringify(res));
            test.ok(!res[0]); // not enough units
            describeAll = await this.$._.$.users.describeAll();
            console.log(JSON.stringify(describeAll[1]));
            test.ok(describeAll[1].users.bob === "0");


            test.done();
        } catch (err) {
            test.ifError(err);
            test.done();
        }
    }
};
