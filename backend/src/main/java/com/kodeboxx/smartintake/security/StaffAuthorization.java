package com.kodeboxx.smartintake.security;

import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Preserves the prototype's staff-session and workspace ownership checks at one boundary. */
@Component
public class StaffAuthorization {
 private final JdbcTemplate db;
 public StaffAuthorization(JdbcTemplate db){this.db=db;}
 public UUID authorize(String workspace,String token){try{UUID a=db.queryForObject("select account_id from staff_sessions where token=? and expires_at>now()",UUID.class,UUID.fromString(token));UUID w=db.queryForObject("select id from workspaces where workspace_key=?",UUID.class,workspace);if(db.queryForObject("select count(*) from memberships where account_id=? and workspace_id=?",Integer.class,a,w)==0)throw new Exception();return w;}catch(Exception e){throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Valid staff workspace session required");}}
 public void requireOwnedForm(String workspace,String token,UUID form){UUID ws=authorize(workspace,token);if(db.queryForObject("select count(*) from forms where id=? and workspace_id=?",Integer.class,form,ws)==0)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Resource not found");}
}
