package com.kodeboxx.smartintake.persistence;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Narrow persistence seam for the append-only audit behavior used by the legacy API. */
@Repository
public class AuditEventRepository {
 private final JdbcTemplate db;
 public AuditEventRepository(JdbcTemplate db){this.db=db;}
 public void record(String action,UUID resourceId){db.update("insert into audit_events(id,action,resource_id) values(?,?,?)",UUID.randomUUID(),action,resourceId);}
}
