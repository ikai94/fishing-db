declare module 'pg' {
  export interface QueryResult<Row extends Record<string, unknown>> {
    rowCount: number | null;
    rows: Row[];
  }

  export class Client {
    constructor(configuration: { connectionString: string });
    connect(): Promise<void>;
    end(): Promise<void>;
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
  }
}
