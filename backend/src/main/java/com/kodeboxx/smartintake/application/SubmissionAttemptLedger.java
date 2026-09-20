package com.kodeboxx.smartintake.application;

import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class SubmissionAttemptLedger {
  private final JdbcTemplate db;

  public SubmissionAttemptLedger(JdbcTemplate db) {
    this.db = db;
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public Map<String, Object> begin(UUID sessionId, String attemptId, String requestDigest) {
    db.update("""
        insert into submission_attempts(session_id,attempt_id,request_digest,state)
        values(?,?,?,'PENDING') on conflict(session_id,attempt_id) do nothing
        """, sessionId, attemptId, requestDigest);
    Map<String, Object> current = status(sessionId, attemptId);
    if (!requestDigest.equals(current.get("requestDigest")))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SUBMISSION_ATTEMPT_REUSED");
    return current;
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void succeeded(UUID sessionId, String attemptId, UUID submissionId) {
    db.update("""
        update submission_attempts set state='SUCCEEDED',submission_id=?,error_code=null,updated_at=now()
        where session_id=? and attempt_id=?
        """, submissionId, sessionId, attemptId);
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void failed(UUID sessionId, String attemptId, String errorCode) {
    db.update("""
        update submission_attempts set state='FAILED',error_code=?,updated_at=now()
        where session_id=? and attempt_id=? and state='PENDING'
        """, errorCode, sessionId, attemptId);
  }

  public Map<String, Object> latest(UUID sessionId) {
    db.update("""
        update submission_attempts a set state='SUCCEEDED',submission_id=s.id,error_code=null,updated_at=now()
        from submissions s where a.session_id=? and a.session_id=s.session_id
          and a.attempt_id=s.attempt_id and a.state='PENDING'
        """, sessionId);
    db.update("""
        update submission_attempts set state='FAILED',error_code='RECOVERY_INCOMPLETE',updated_at=now()
        where session_id=? and state='PENDING' and updated_at < now() - interval '5 minutes'
        """, sessionId);
    return db.queryForObject("""
        select attempt_id,state,submission_id,error_code,request_digest
        from submission_attempts where session_id=? order by updated_at desc limit 1
        """, (rs, row) -> publicStatus(rs.getString(1), rs.getString(2),
            (UUID) rs.getObject(3), rs.getString(4), rs.getString(5)), sessionId);
  }

  public Map<String, Object> status(UUID sessionId, String attemptId) {
    return db.queryForObject("""
        select attempt_id,state,submission_id,error_code,request_digest
        from submission_attempts where session_id=? and attempt_id=?
        """, (rs, row) -> publicStatus(rs.getString(1), rs.getString(2),
            (UUID) rs.getObject(3), rs.getString(4), rs.getString(5)), sessionId, attemptId);
  }

  private static Map<String, Object> publicStatus(
      String attemptId, String state, UUID submissionId, String errorCode, String requestDigest) {
    Map<String, Object> result = new java.util.LinkedHashMap<>();
    result.put("attemptId", attemptId);
    result.put("state", state.toLowerCase(java.util.Locale.ROOT));
    result.put("submissionId", submissionId);
    result.put("errorCode", errorCode);
    result.put("requestDigest", requestDigest);
    return result;
  }
}
