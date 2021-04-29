# Caf.js

Co-design cloud assistants with your web app and IoT devices.

See https://www.cafjs.com

## Redis Library for Caf.js
[![Build Status](https://travis-ci.org/cafjs/caf_redis.svg?branch=master)](https://travis-ci.org/cafjs/caf_redis)


This library provides components to checkpoint the state of CAs using Redis.

CAF Redis uses a lease-based  mechanism to ensure that at most one instance of a particular CA is active in the data centre. This keeps CA state consistent.

Lease ownership is based on a unique id associated with the CA hosting node.js process. This process should also ensure uniqueness for its own CAs.

Only the owner can read, update, or permanently delete the CA state.

A hosting node.js process is responsible to periodically renew leases for its CAs.  If the node.js process dies, leases would expire, and another process can take over. Operations always check first that the lease is current, and fail otherwise. This is done atomically using LUA scripts executed by Redis.

To improve performance we aggregate both state updates and lease renewals from several local CAs in a single LUA request. To increase granularity of these group commits, we synchronize lease renewals and introduce an update delay in the client.

## API

This is an **internal** API for other services. Application code should not use it directly.

See {@link  module:caf_redis/plug_checkpoint}

## Configuration

### framework.json

See {@link  module:caf_redis/gen_redis_plug}
