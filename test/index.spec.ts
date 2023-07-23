import { v4 as uuidv4 } from 'uuid';
import CosmosStore, { CosmosStoreOptions } from '../src/';
import { Container, CosmosClient, Database } from '@azure/cosmos';
import dotenv from 'dotenv';
import { SessionData } from 'express-session';

dotenv.config();

const endpoint = process.env.COSMOS_ENDPOINT || '';
const cosmosKey = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE || 'database';
const containerId =
  process.env.COSMOS_CONTAINER || CosmosStore.DEFAULT_CONTAINER_NAME;

const client = new CosmosClient({
  endpoint: endpoint,
  key: cosmosKey,
});

const defaultOptions: CosmosStoreOptions = {
  cosmosClient: client,
  databaseName: databaseId,
  containerName: containerId,
};

//Mock a session
const generateRandomSession = (maxAge = 60000): [string, SessionData] => {
  const sessionId = uuidv4();
  const userId = uuidv4();
  const cookie = {
    secure: true,
    httpOnly: true,
    path: '/',
  };
  const session = {
    cookie:
      maxAge !== 0
        ? {
            originalMaxAge: maxAge,
            expires: new Date(Date.now() + maxAge),
            ...cookie,
          }
        : {
            originalMaxAge: null,
            ...cookie,
          },
    user: {
      id: userId,
    },
  };

  return [sessionId, session];
};

//Customer TTL generator mock
const getTTL = () => 5;

const getSessionFromDB = async (sessionId: string) => {
  const { resource } = await client
    .database(databaseId)
    .container(containerId)
    .item(sessionId, sessionId)
    .read();

  return resource as SessionData | null;
};

afterAll(async () => {
  // Delete the containers
  await client.database(databaseId).container(containerId).delete();
  await client
    .database(databaseId)
    .container(CosmosStore.DEFAULT_CONTAINER_NAME)
    .delete();
});

describe('Cosmos Store - Initialization', () => {
  jest.setTimeout(1000000);

  //Reset Cosmos Store after each test
  afterEach(() => {
    CosmosStore.reset();
  });

  it('should not create a new instance of CosmosStore', async () => {
    const options: CosmosStoreOptions = {
      ...defaultOptions,
    };

    const test = () => {
      //@ts-ignore comment
      new CosmosStore(options);
    };

    // Not initialized and Constructor not allowed
    expect(test).toThrow();

    await CosmosStore.initializeStore(options);

    // Already initialized but constructor not allowed
    expect(test).toThrow();
  });

  it('should initialize a Cosmos store with default container name', async () => {
    const options: CosmosStoreOptions = {
      ...defaultOptions,
      containerName: undefined,
    };

    const cosmosStore = await CosmosStore.initializeStore(options);

    expect(cosmosStore).toBeInstanceOf(CosmosStore);

    const { database } = await client.database(databaseId).read();

    expect(database).toBeInstanceOf(Database);

    const container = database.container(CosmosStore.DEFAULT_CONTAINER_NAME); //Default container name is 'sessions'
    expect(container.id).toBe(CosmosStore.DEFAULT_CONTAINER_NAME);

    const anotherInstance = await CosmosStore.initializeStore(options);

    expect(anotherInstance).toBe(cosmosStore);
  });

  it('should initialize a Cosmos store with custom container name', async () => {
    const options: CosmosStoreOptions = {
      ...defaultOptions,
    };

    const cosmosStore = await CosmosStore.initializeStore(options);

    expect(cosmosStore).toBeInstanceOf(CosmosStore);

    const { database } = await client.database(databaseId).read();

    expect(database).toBeInstanceOf(Database);

    const container = database.container(containerId);
    expect(container.id).toBe(containerId);

    const anotherInstance = await CosmosStore.initializeStore(options);

    expect(anotherInstance).toBe(cosmosStore);
  });
});

describe('Cosmos Store - Operations', () => {
  const options: CosmosStoreOptions = {
    ...defaultOptions,
  };

  it('should set, get and destroy sessions', async () => {
    const cosmosStore = await CosmosStore.initializeStore(options);
    const [sessionId, session] = generateRandomSession();
    // Set the session
    await cosmosStore.set(sessionId, session);

    const result = await getSessionFromDB(sessionId);
    expect(result).toMatchObject(JSON.parse(JSON.stringify(session)));

    // Get the session
    await cosmosStore.get(sessionId, (err, data) => {
      expect(err).toBeNull();
      expect(data).toMatchObject(JSON.parse(JSON.stringify(session)));
    });

    // Destroy the session
    await cosmosStore.destroy(sessionId);

    const destroyedSession = await getSessionFromDB(sessionId);
    expect(destroyedSession).toBeUndefined();

    await cosmosStore.get(sessionId, (err, data) => {
      expect(err).toBeNull();
      expect(data).toBeNull();
    });
  });

  it('should return all the sessions and the count of sessions in the container', async () => {
    const cosmosStore = await CosmosStore.initializeStore(options);
    for (let i = 0; i < 5; i++) {
      const [sessionId, session] = generateRandomSession();
      await cosmosStore.set(sessionId, session);
    }

    //get session length
    await cosmosStore.length((err, length) => {
      expect(err).toBeNull();
      expect(length).toBe(5);
    });

    //get All sessions
    await cosmosStore.all((err, allSessions) => {
      expect(err).toBeNull();
      expect(allSessions).toBeDefined();

      if (allSessions) {
        for (const session of allSessions) {
          expect(session).toBeDefined();
        }
      }

      expect(allSessions).toHaveLength(5);
    });
  });

  it('should clear all the sessions in the container', async () => {
    const cosmosStore = await CosmosStore.initializeStore(options);
    await cosmosStore.clear();

    // Container should be recreated.
    const { container } = await client
      .database(databaseId)
      .container(containerId)
      .read();

    expect(container).toBeInstanceOf(Container);

    //get session length
    await cosmosStore.length((err, length) => {
      expect(err).toBeNull();
      expect(length).toBe(0);
    });

    // All should return empty array
    await cosmosStore.all((err, allSessions) => {
      expect(err).toBeNull();
      expect(allSessions).toHaveLength(0);
    });
  });

  it('should not add an already expired session', async () => {
    const cosmosStore = await CosmosStore.initializeStore(options);
    const [pastTTLSessionId, pastTTLSession] = generateRandomSession(-60000);

    // Should not be added, as expiry is in the past
    await cosmosStore.set(pastTTLSessionId, pastTTLSession);

    await cosmosStore.length((err, length) => {
      expect(err).toBeNull();
      expect(length).toBe(0);
    });
  });

  it('should expire a session as per Expire value', async () => {
    CosmosStore.reset(); // Reset the store to use custom TTL
    const cosmosStore = await CosmosStore.initializeStore(options);

    const [sessionId, session] = generateRandomSession(5000);
    await cosmosStore.set(sessionId, session);

    await new Promise(resolve => setTimeout(resolve, 6000));

    const expiredSession = await getSessionFromDB(sessionId);

    expect(expiredSession).toBeUndefined();
  });

  it('should expire a session with custom TTL value', async () => {
    CosmosStore.reset(); // Reset the store to use custom TTL
    const cosmosStore = await CosmosStore.initializeStore({
      ...options,
      ttl: 5, // expire after 5 seconds
    });

    const [sessionId, session] = generateRandomSession(0); // With no expiry and maxAge
    await cosmosStore.set(sessionId, session);

    await new Promise(resolve => setTimeout(resolve, 6000));

    const expiredSession = await getSessionFromDB(sessionId);

    expect(expiredSession).toBeUndefined();
  });

  it('should expire a session with custom TTL function', async () => {
    CosmosStore.reset(); // Reset the store to use custom TTL
    const cosmosStore = await CosmosStore.initializeStore({
      ...options,
      ttl: getTTL,
    });

    const [sessionId, session] = generateRandomSession(0); // With no expiry and maxAge
    await cosmosStore.set(sessionId, session);

    await new Promise(resolve => setTimeout(resolve, 6000));

    const expiredSession = await getSessionFromDB(sessionId);

    expect(expiredSession).toBeUndefined();
  });

  it('should touch a session to prevent it from expiring', async () => {
    CosmosStore.reset(); // Reset the store to use custom TTL
    const cosmosStore = await CosmosStore.initializeStore({
      ...options,
      ttl: 5,
    });

    const [sessionId, session] = generateRandomSession(0); // With no expiry and maxAge
    await cosmosStore.set(sessionId, session);

    await new Promise(resolve => setTimeout(resolve, 2000));
    await cosmosStore.touch(sessionId, session);
    await new Promise(resolve => setTimeout(resolve, 3000));
    let expiredSession = await getSessionFromDB(sessionId);
    expect(expiredSession).toMatchObject(session);

    await new Promise(resolve => setTimeout(resolve, 5000));
    expiredSession = await getSessionFromDB(sessionId);
    expect(expiredSession).toBeUndefined();
  });

  it('should not touch a session to prevent it from expiring, if disableTouch is enabled', async () => {
    CosmosStore.reset(); // Reset the store to use custom TTL
    const cosmosStore = await CosmosStore.initializeStore({
      ...options,
      ttl: 5,
      disableTouch: true,
    });

    const [sessionId, session] = generateRandomSession(0); // With no expiry and maxAge
    await cosmosStore.set(sessionId, session);

    await new Promise(resolve => setTimeout(resolve, 3000));
    await cosmosStore.touch(sessionId, session);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const expiredSession = await getSessionFromDB(sessionId);

    expect(expiredSession).toBeUndefined();
  });
});
