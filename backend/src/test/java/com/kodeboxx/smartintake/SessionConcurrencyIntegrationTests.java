package com.kodeboxx.smartintake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.kodeboxx.smartintake.application.IntakeApplicationService;
import com.kodeboxx.smartintake.compatibility.CompatibilityProfile;
import com.kodeboxx.smartintake.compatibility.RespondentSecretVerifier;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
class SessionConcurrencyIntegrationTests {
  private static final String DEFINITION =
      "{\"contractVersion\":\"4.0.0\",\"pages\":[{\"id\":\"page\",\"fields\":[]}]}";

  @Autowired IntakeApplicationService intake;
  @Autowired JdbcTemplate db;
  @Autowired RespondentSecretVerifier secrets;

  @Test
  void serializes_different_mutation_ids_and_replays_the_same_mutation_id() throws Exception {
    Fixture fixture = fixture();
    UUID firstMutation = UUID.randomUUID();
    UUID secondMutation = UUID.randomUUID();
    List<Future<Map<String, Object>>> different =
        concurrently(
            () ->
                intake.patch(fixture.session(), fixture.bearer().toString(), patch(firstMutation)),
            () ->
                intake.patch(
                    fixture.session(), fixture.bearer().toString(), patch(secondMutation)));

    int accepted = 0;
    int conflicts = 0;
    for (Future<Map<String, Object>> future : different) {
      try {
        assertEquals(1L, ((Number) future.get().get("acceptedRevision")).longValue());
        accepted++;
      } catch (ExecutionException failure) {
        assertTrue(failure.getCause() instanceof ResponseStatusException);
        assertEquals(
            HttpStatus.CONFLICT, ((ResponseStatusException) failure.getCause()).getStatusCode());
        conflicts++;
      }
    }
    assertEquals(1, accepted);
    assertEquals(1, conflicts);
    assertEquals(
        1L,
        db.queryForObject(
            "select revision from sessions where id=?", Long.class, fixture.session()));
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from session_mutations where session_id=?",
            Integer.class,
            fixture.session()));

    Fixture replayFixture = fixture();
    UUID replayMutation = UUID.randomUUID();
    List<Future<Map<String, Object>>> replay =
        concurrently(
            () ->
                intake.patch(
                    replayFixture.session(),
                    replayFixture.bearer().toString(),
                    patch(replayMutation)),
            () ->
                intake.patch(
                    replayFixture.session(),
                    replayFixture.bearer().toString(),
                    patch(replayMutation)));
    Map<String, Object> firstReplay = replay.get(0).get();
    Map<String, Object> secondReplay = replay.get(1).get();
    assertEquals(1L, ((Number) firstReplay.get("acceptedRevision")).longValue());
    assertEquals(
        ((Number) firstReplay.get("acceptedRevision")).longValue(),
        ((Number) secondReplay.get("acceptedRevision")).longValue());
    assertEquals(firstReplay.get("answers"), secondReplay.get("answers"));
    assertEquals(firstReplay.get("validation"), secondReplay.get("validation"));
    assertEquals(
        1L,
        db.queryForObject(
            "select revision from sessions where id=?", Long.class, replayFixture.session()));
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from session_mutations where session_id=?",
            Integer.class,
            replayFixture.session()));
  }

  @Test
  void serializes_concurrent_submissions_to_one_receipt() throws Exception {
    Fixture fixture = fixture();
    List<Future<ResponseEntity<?>>> results =
        concurrently(
            () ->
                intake.submit(
                    fixture.session(),
                    fixture.bearer().toString(),
                    new IntakeApplicationService.Submit(0L)),
            () ->
                intake.submit(
                    fixture.session(),
                    fixture.bearer().toString(),
                    new IntakeApplicationService.Submit(0L)));
    ResponseEntity<?> first = results.get(0).get();
    ResponseEntity<?> second = results.get(1).get();
    assertEquals(HttpStatus.CREATED, first.getStatusCode());
    assertEquals(HttpStatus.CREATED, second.getStatusCode());
    assertEquals(first.getBody(), second.getBody());
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from submissions where session_id=?",
            Integer.class,
            fixture.session()));
  }

  private IntakeApplicationService.PatchSession patch(UUID mutation) {
    return new IntakeApplicationService.PatchSession(0L, mutation, Map.of());
  }

  private Fixture fixture() {
    UUID form = UUID.randomUUID();
    UUID release = UUID.randomUUID();
    UUID session = UUID.randomUUID();
    UUID bearer = UUID.randomUUID();
    db.update(
        "insert into forms(id,form_key,title,definition,compatibility_profile_key)"
            + " values(?,?,?,cast(? as jsonb),?)",
        form,
        "concurrency-" + form,
        "Concurrency",
        DEFINITION,
        CompatibilityProfile.M1_CURRENT_PROTOTYPE.key());
    db.update(
        "insert into form_releases(id,form_id,version,package,compatibility_profile_key)"
            + " values(?,?,1,cast(? as jsonb),?)",
        release,
        form,
        DEFINITION,
        CompatibilityProfile.M1_CURRENT_PROTOTYPE.key());
    db.update(
        "insert into"
            + " sessions(id,form_id,release_id,respondent_token,respondent_secret_sha256,compatibility_profile_key,answers)"
            + " values(?,?,?,?,?,?,cast('{}' as jsonb))",
        session,
        form,
        release,
        UUID.randomUUID(),
        secrets.digest(bearer),
        CompatibilityProfile.M1_CURRENT_PROTOTYPE.key());
    return new Fixture(session, bearer);
  }

  @SafeVarargs
  private final <T> List<Future<T>> concurrently(java.util.concurrent.Callable<T>... calls)
      throws InterruptedException {
    ExecutorService pool = Executors.newFixedThreadPool(calls.length);
    CountDownLatch ready = new CountDownLatch(calls.length);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<Future<T>> futures = new ArrayList<>();
      for (var call : calls) {
        futures.add(
            pool.submit(
                () -> {
                  ready.countDown();
                  start.await();
                  return call.call();
                }));
      }
      ready.await();
      start.countDown();
      return futures;
    } finally {
      pool.shutdown();
    }
  }

  private record Fixture(UUID session, UUID bearer) {}
}
