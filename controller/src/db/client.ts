import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | null = null;

export function initSql(
	connectionString?: string,
): ReturnType<typeof postgres> {
	const url = connectionString ?? process.env["DATABASE_URL"];
	if (!url) throw new Error("DATABASE_URL environment variable is required");
	// DB-03: statement_timeout prevents a slow or deadlocked query from holding
	// a connection indefinitely and exhausting the pool (max: 10) under load.
	_sql = postgres(url, {
		max: 10,
		idle_timeout: 30,
		connect_timeout: 10,
		connection: { statement_timeout: 30_000 },
	});
	return _sql;
}

export function getSql(): ReturnType<typeof postgres> {
	if (!_sql) return initSql();
	return _sql;
}

// Lazy-initializing proxy that works as both a tagged-template function
// and an object with methods (.begin, .end, .unsafe, etc.)
export const sql = new Proxy(
	(() => {}) as unknown as ReturnType<typeof postgres>,
	{
		apply(_target, _thisArg, argArray) {
			// postgres.js Proxy shim — typed via ReturnType<typeof postgres>
			return (getSql() as any)(...argArray); // eslint-disable-line @typescript-eslint/no-explicit-any
		},
		get(_target, prop) {
			// postgres.js Proxy shim — typed via ReturnType<typeof postgres>
			return (getSql() as any)[prop]; // eslint-disable-line @typescript-eslint/no-explicit-any
		},
	},
);

export async function closeSql(): Promise<void> {
	if (_sql) {
		await _sql.end();
		_sql = null;
	}
}
