ALTER TABLE entries ADD COLUMN unit_points INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(unit_points) = 'integer' AND unit_points BETWEEN -100 AND 100 AND unit_points <> 0);
ALTER TABLE entries ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 100);
UPDATE entries SET unit_points = points;
