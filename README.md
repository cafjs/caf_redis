# CAF (Cloud Assistant Framework)

Co-design permanent, active, stateful, reliable cloud proxies with your web app.

See http://www.cafjs.com 

## CAF Redis

[![Build Status](http://ci.cafjs.com/github.com/cafjs/caf_redis/status.svg?branch=master)](http://ci.cafjs.com/github.com/cafjs/caf_redis)


This library provides components to checkpoint the state of CAs using Redis.

CAF Redis uses a lease-based  mechanism to ensure that at most one instance of a particular CA is active in the data centre. This keeps CA state consistent.

Lease ownership is based on a unique id associated with the CA hosting node.js process. This process should also ensure uniqueness for its own CAs. 

Only the owner can read, update, or permanently delete the CA state.

A hosting node.js process is responsible to periodically renew leases for its CAs.  If the node.js process dies, leases would expire, and another process can take over. Operations always check first that the lease is current, and fail otherwise. This is done atomically using LUA scripts executed by Redis.

To improve performance we aggregate both state updates and lease renewals from several local CAs in a single LUA request. To increase granularity of these group commits, we synchronize lease renewals and introduce an update delay in the client.

## API

    lib/plug_checkpoint.js
 
## Configuration Example

### framework.json

    {
            "module": "plug_checkpoint",
            "name": "cp",
            "env": {
               "nodeId": "ssdsdasdsd",
               "redis" : {
                   "password" : null,
                   "hostname" : "localhost",
                   "port" : 6379
                },
                "coalescing" : {
                    "interval" : 10,
                    "maxPendingUpdates" : 10
                }
            }
    }
    
*  `nodeId:` a default identifier for the lease owner of all the CAs that
use this plug.
*  `interval:` the number of miliseconds that we delay update requests, so we can aggregate them in a single request.
*  `maxPendingUpdates:` The maximum number of pending updates before flushing them in a single request.

