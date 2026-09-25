CREATE TABLE class_rules (
  id TEXT NOT NULL,
  class_id TEXT NOT NULL REFERENCES classrooms(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  points INTEGER NOT NULL CHECK(typeof(points) = 'integer' AND points BETWEEN -100 AND 100 AND points <> 0),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 500),
  version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version) = 'integer' AND version >= 1),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  creation_hash TEXT,
  PRIMARY KEY (class_id,id)
);
CREATE INDEX class_rules_active ON class_rules(class_id,deleted_at,sort_order);
CREATE TABLE class_rule_initializations (
  class_id TEXT PRIMARY KEY NOT NULL REFERENCES classrooms(id),
  initialized_at TEXT NOT NULL
);

INSERT INTO class_rules (id,class_id,category,title,points,note,version,sort_order,created_at,updated_at)
SELECT json_extract(rule.value,'$.id'),c.id,json_extract(rule.value,'$.category'),json_extract(rule.value,'$.title'),
  json_extract(rule.value,'$.points'),'',1,CAST(rule.key AS INTEGER),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM classrooms c CROSS JOIN json_each('[{"id":"reading","category":"早读","title":"早读认真","points":1},{"id":"answer","category":"上课","title":"主动举手回答问题","points":1},{"id":"homework","category":"作业","title":"未按时交作业","points":-1},{"id":"duty","category":"卫生","title":"无故不值日","points":-2},{"id":"reading-talk","category":"早读","title":"早读未读书或讲话","points":-1},{"id":"seat","category":"课前","title":"铃响未回座位或继续讲话","points":-1},{"id":"supplies","category":"课前","title":"未准备课本和学习用品","points":-1},{"id":"class-discipline","category":"上课","title":"课堂一般违纪","points":-1},{"id":"class-praise","category":"上课","title":"课堂获老师表扬","points":1},{"id":"eye-discipline","category":"眼操","title":"眼操不认真","points":-1},{"id":"eye-award","category":"眼操","title":"获得眼操红旗","points":1},{"id":"break-discipline","category":"课间","title":"课间违纪","points":-1},{"id":"civilized-award","category":"课间","title":"获得文明红旗","points":1},{"id":"study-praise","category":"自习课","title":"自习课获表扬","points":1},{"id":"hygiene-discipline","category":"卫生","title":"乱扔垃圾或带零食进教室","points":-1},{"id":"duty-careless","category":"卫生","title":"值日不认真","points":-1},{"id":"cleaning-unfinished","category":"卫生","title":"上课后仍未完成卫生打扫","points":-1},{"id":"flag-uniform","category":"升旗","title":"升旗未穿校服","points":-1},{"id":"flag-discipline","category":"升旗","title":"升旗讲话或乱动","points":-1},{"id":"queue-award","category":"路队","title":"获得路队红旗","points":1}]') rule;
INSERT INTO class_rule_initializations (class_id,initialized_at)
SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM classrooms;
