import { SessionData, Store } from 'express-session';
import { Container, CosmosClient, Database } from '@azure/cosmos';

const noop: (err?: any, data?: any) => void = () => null;

export interface CosmosStoreOptions {
  cosmosClient: CosmosClient;
  databaseName: string;
  containerName?: string;
  ttl?: number | { (session: SessionData): number };
  disableTouch?: boolean;
}

export default class CosmosStore extends Store {
  private static options: Required<CosmosStoreOptions> | Record<string, never> =
    {};
  private database!: Database;
  private container!: Container;
  public static readonly PARTITION_KEY_PATH = '/id';
  private static _store: CosmosStore | null;
  public static readonly DEFAULT_CONTAINER_NAME = 'sessions';
  public static readonly DEFAULT_TTL = 86400;

  private constructor() {
    super();

    if (CosmosStore._store)
      throw new Error(
        'Cosmos Store has already been initialized. Please use CosmosStore.initializeStore()'
      );

    if (!CosmosStore.options.cosmosClient) {
      throw new Error(
        'Cannot initialize Cosmos Store. Please use CosmosStore.initializeStore()'
      );
    }
  }

  // Update static options
  private static updateOptions(options: CosmosStoreOptions): void {
    CosmosStore.options.cosmosClient = options.cosmosClient;
    CosmosStore.options.containerName =
      options.containerName || CosmosStore.DEFAULT_CONTAINER_NAME;
    CosmosStore.options.databaseName = options.databaseName;
    CosmosStore.options.disableTouch = options.disableTouch || false;
    CosmosStore.options.ttl = options.ttl || CosmosStore.DEFAULT_TTL; //Default TTL is 1 day
  }

  /**
   * Initialize a Cosmos Store instance for Session Storage.
   * @param options Cosmos Store Options
   * @returns A Cosmos Store instance
   */
  static async initializeStore(
    options: CosmosStoreOptions
  ): Promise<CosmosStore> {
    if (!options.cosmosClient) throw new Error('Cosmos DB Client is required.');
    if (!options.databaseName) throw new Error('Database name is required');

    if (CosmosStore._store) {
      return CosmosStore._store;
    }

    CosmosStore.updateOptions(options);
    CosmosStore._store = new CosmosStore();
    await CosmosStore._store.setup();

    return CosmosStore._store;
  }

  /**
   *
   * Get the session dat for the session ID
   * @param sid Session ID
   * @param callback callback function to call after execution
   */
  async get(
    sid: string,
    callback: (
      err: any,
      session?: SessionData | null | undefined
    ) => void = noop
  ): Promise<void> {
    try {
      const { resource } = await this.container
        .item(sid, sid)
        .read<SessionData>();

      if (!resource) {
        return callback(null, null);
      }

      return callback(null, resource);
    } catch (error) {
      callback(error);
    }
  }

  /**
   *  Set the session data for the session ID
   * @param sid Session ID
   * @param session Session data
   * @param callback callback function to call after execution
   */
  async set(
    sid: string,
    session: SessionData,
    callback: ((err?: any) => void) | undefined = noop
  ): Promise<void> {
    const currentTTL = this.getTTL(session);

    try {
      const sessionItem = {
        id: sid,
        ...session,
      };

      if (currentTTL) {
        //TTL is set or is computed from "Expires" value.
        if (currentTTL <= 0) {
          //TTL Expired
          return this.destroy(sid);
        }

        // Upsert session with TTL
        await this.container.items.upsert({
          ...sessionItem,
          ttl: currentTTL,
        });
      } else {
        // Upsert session without TTL
        await this.container.items.create({ ...sessionItem });
      }
    } catch (error) {
      callback(error);
    }
  }

  /**
   * Destroy a session.
   *
   * @param sid Session ID to destroy
   * @param callback callback function to call after execution
   */
  async destroy(
    sid: string,
    callback: ((err?: any) => void) | undefined = noop
  ): Promise<void> {
    try {
      await this.container.item(sid, sid).delete();
    } catch (error) {
      callback(error);
    }
  }

  /**
   * Get all sessions in the store
   * @param callback callback function to call after execution
   */
  async all(
    callback: (err: any, obj?: SessionData[]) => void = noop
  ): Promise<void> {
    try {
      const { resources } = await this.container.items.readAll().fetchAll();
      callback(null, resources as SessionData[]);
    } catch (error) {
      callback(error);
    }
  }

  /** Returns the number of sessions in the store. */
  async length(
    callback: (err: any, length?: number) => void = noop
  ): Promise<void> {
    try {
      const { resources } = await this.container.items
        .query({
          query: `SELECT VALUE COUNT(s.id) FROM ${this.container.id} s`,
        })
        .fetchAll();

      const [count] = resources as number[]; //Result is a JSON array

      callback(null, count);
    } catch (error) {
      callback(error);
    }
  }

  /** Delete all sessions from the store. */
  async clear(callback: (err?: any) => void = noop): Promise<void> {
    try {
      const { containerName } = CosmosStore.options;
      await this.database?.container(containerName).delete();
      await this.createContainer();
    } catch (error) {
      callback(error);
    }
  }

  /** "Touches" a given session, resetting the idle timer. */
  async touch(
    sid: string,
    session: SessionData,
    callback: () => void = noop
  ): Promise<void> {
    if (CosmosStore.options.disableTouch) {
      return callback();
    }

    try {
      // Note: Any write/update operation will update the TTL value in Cosmos.
      await this.container.item(sid, sid).patch({
        operations: [
          {
            op: 'replace',
            path: '/ttl',
            value: this.getTTL(session),
          },
        ],
      });
      callback();
    } catch (error) {
      callback();
    }
  }

  // Initial Cosmos DB set-up
  private async setup(): Promise<void> {
    const { databaseName, containerName, cosmosClient } = CosmosStore.options;

    const { database } = await cosmosClient.databases.createIfNotExists({
      id: databaseName,
    });

    this.database = database;

    await this.createContainer();

    this.container = this.database.container(containerName);
  }

  private async createContainer() {
    const { containerName } = CosmosStore.options;

    // The TTL value can be overridden on individual items, if default TTL is non-null or -1.
    // TTL is disabled by default
    // If TTL was already defined (e.g. via Azure Portal/CLI), the predefined value would be used here,
    // as the container would have been created already.
    await this.database?.containers.createIfNotExists({
      id: containerName,
      defaultTtl: -1, // Enable TTL by setting -1
      partitionKey: CosmosStore.PARTITION_KEY_PATH,
    });
  }

  /**
   * Get Time to live value in seconds for the session.
   * If the Expires value is set, TTL will be calculated based on Expiry.
   * Else the default value of 1 day would be used.
   * @param session
   * @returns TTL value in seconds (Cosmos DB uses seconds as TTL)
   */
  private getTTL(session: SessionData) {
    // Custom expiry computation.
    if (typeof CosmosStore.options.ttl === 'function')
      return CosmosStore.options.ttl(session);

    if (session.cookie && session.cookie.expires) {
      const sessionExpiry = Number(new Date(session.cookie.expires));
      const current = Date.now();

      //Cosmos DB TTL in seconds
      return Math.ceil((sessionExpiry - current) / 1000);
    }

    return CosmosStore.options.ttl;
  }

  static reset(): void {
    CosmosStore._store = null;
    CosmosStore.options = {};
  }
}
