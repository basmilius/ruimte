-- The last whole answer from Artificial Analysis, reduced to what the model comparison draws. One row.
CREATE TABLE model_benchmarks (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fetched_at INTEGER NOT NULL,
    models TEXT NOT NULL
);
