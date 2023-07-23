# connect-cosmosdb 🚀

[![npm package][npm-img]][npm-url] [![Build Status][build-img]][build-url] [![Downloads][downloads-img]][downloads-url] [![Issues][issues-img]][issues-url] [![Code Coverage][codecov-img]][codecov-url] [![Commitizen Friendly][commitizen-img]][commitizen-url] [![Semantic Release][semantic-release-img]][semantic-release-url]

A Cosmos DB based store for sessions storage in express-session. 

## Installation 🔧

connect-cosmosdb runs alongside the Azure CosmosDB SDK for Node.js. The SDK is a peer dependency and must be installed separately.

```bash
npm install connect-cosmosdb @azure/cosmos
```
## Usage 

### Initialize a Cosmos DB Client

Initialize CosmosDB SDK with your Cosmos DB account credentials. See [here](https://docs.microsoft.com/en-us/azure/cosmos-db/create-sql-api-nodejs#configure-your-nodejs-application-to-use-the-cosmos-client-library) for more information.

Below is an example, that uses the passwordless connection to Cosmos DB, which is the recommended way to connect to CosmosDB. 

```ts
// Get Identity Client
import { DefaultAzureCredential } from "@azure/identity";
// Get Cosmos Client
import { CosmosClient } from "@azure/cosmos";
const cosmosClient = new CosmosClient({ 
    endpoint: process.env.COSMOS_ENDPOINT, 
    aadCredentials: new DefaultAzureCredential() 
});
```
Alternatively, you can also connect using the Cosmos DB Key. Just replace `aadCredentials` with `key: process.env.COSMOS_KEY` in the above example.

### Initialize connect-cosmosdb

Once you have initialized the Cosmos DB client, you can now initialize the CosmosStore for express-session.

```ts
import CosmosStore, { CosmosStoreOptions } from 'connect-cosmosdb';

...

// Cosmos Store Options
const cosmosStoreOptions: CosmosStoreOptions = {
    cosmosClient: cosmosClient,
    databaseName: process.env.COSMOS_DATABASE,
    containerName: process.env.COSMOS_COLLECTION,
    ttl: 86400,
    disableTouch: false
};

// Initialize Cosmos Store 
const cosmosStore = await CosmosStore.initializeStore(options);

// Initialize Express Session

app.use(session({
    store: cosmosStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true }
}));
```

### Options

The following options are available for configuring the CosmosStore.

```ts
interface CosmosStoreOptions {
  cosmosClient: CosmosClient;
  databaseName: string;
  containerName?: string;
  ttl?: number | { (session: SessionData): number };
  disableTouch?: boolean;
}
```

#### cosmosClient (required)

The CosmosClient instance. This is a required option. See the Initialization section above on how you can initialize a CosmosClient instance. 

#### databaseName (required)

The database name to use for storing the session data. If the database does not exist, it will be created.

#### containerName (optional)

The container name to use for storing the session data. If the collection name is not provided, `sessions` will be used by default. If the container does not exist, it will be created. 

**Note for pre-existing containers:** If you are using a pre-existing container, please make sure that the container has a partition key of `/id`. If the container does not have a partition key of `/id`, then you will need to create a new container with a partition key of `/id`. 

If you also plan on utilizing the TTL feature, ensure that the TTL value is set to -1 (programmatically) or `On (no default)`/ `On` (via the Azure Portal) for the container. 

Both of the above options are automatically set, if the container is created by connect-cosmosdb.

#### ttl (optional)

The time-to-live (TTL) value in seconds for the session data. The value is specified in seconds, as Cosmos DB uses seconds as a TTL value. More information on Cosmos DB TTL can be found here: [Time to Live (TTL) in Azure Cosmos DB](https://docs.microsoft.com/en-us/azure/cosmos-db/time-to-live).

Below is the order in which the TTL for a session is calculated:

1. If a function is provided, then the session data will expire after the number of seconds returned by the function. This can be used to compute the TTL value dynamically based on the session data. The function is passed the session data as an argument.

2. If there's an `Expires` property in `session.cookie`, then the value of the `Expires` property will be used as the TTL value. The `Expires` property is a `Date` object that specifies the time when the session data will expire.

3. If there is no `Expires` value, and if `ttl` is a number, then the session data will have this value as the `ttl` when stored as an item in the Cosmos container and would be deleted (expire) after the specified number of seconds.

If no TTL value is provided, then the session data will expire after 24 hours (86400 seconds) by default.

#### disableTouch (optional)

Disables the `touch` functionality, to reset TTL. The default value is `false`. 

As connect-cosmosdb is intended to be used with express-session as a session store, it supports the `touch` functionality in express-session (see [here](https://github.com/expressjs/session#storetouchsid-session-callback))


##### How does `touch` work? 

By default, the session data stored in the store would expire when the TTL runs out, and the data would be deleted from the store. The user session is no longer valid in this case. It is sometimes desirable to keep the session active for a longer time, if the user is still active and not idle. 

With the `touch` functionality, when the user is still active and interacting with the session, the session middleware added by `express-session`, touches the user sessions, and resets the idle timer (TTL value). This is done by calling the `touch` function exposed by the store.


[build-img]: https://github.com/thekillingspree/connect-cosmosdb/actions/workflows/release.yml/badge.svg
[build-url]: https://github.com/thekillingspree/connect-cosmosdb/actions/workflows/release.yml
[downloads-img]: https://img.shields.io/npm/dt/connect-cosmosdb
[downloads-url]: https://www.npmtrends.com/connect-cosmosdb
[npm-img]: https://img.shields.io/npm/v/connect-cosmosdb
[npm-url]: https://www.npmjs.com/package/connect-cosmosdb
[issues-img]: https://img.shields.io/github/issues/thekillingspree/connect-cosmosdb
[issues-url]: https://github.com/thekillingspree/connect-cosmosdb/issues
[codecov-img]: https://codecov.io/gh/thekillingspree/connect-cosmosdb/branch/main/graph/badge.svg
[codecov-url]: https://codecov.io/gh/thekillingspree/connect-cosmosdb
[semantic-release-img]: https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg
[semantic-release-url]: https://github.com/semantic-release/semantic-release
[commitizen-img]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[commitizen-url]: http://commitizen.github.io/cz-cli/
