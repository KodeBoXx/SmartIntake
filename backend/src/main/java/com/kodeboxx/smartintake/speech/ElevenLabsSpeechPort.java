package com.kodeboxx.smartintake.speech;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Reference ElevenLabs adapter. The key is read only from server configuration and the disabled
 * path is explicit, bounded, and side-effect free. Callers never receive provider error details.
 */
@Component
public class ElevenLabsSpeechPort implements SpeechPort {
  private static final Set<String> LOCALES = Set.of("en", "hi", "ar");
  private final String apiKey;
  private final String endpoint;
  private final Map<String, Set<String>> approvedVoices;
  private final HttpClient client;
  private final AtomicLong requests = new AtomicLong();
  private final AtomicLong failures = new AtomicLong();

  public ElevenLabsSpeechPort(@Value("${smartintake.speech.elevenlabs-api-key:}") String apiKey,
      @Value("${smartintake.speech.elevenlabs-endpoint:https://api.elevenlabs.io/v1/text-to-speech}") String endpoint,
      @Value("${smartintake.speech.elevenlabs-voices.en:}") String englishVoices,
      @Value("${smartintake.speech.elevenlabs-voices.hi:}") String hindiVoices,
      @Value("${smartintake.speech.elevenlabs-voices.ar:}") String arabicVoices) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.approvedVoices = Map.of(
        "en", voices(englishVoices), "hi", voices(hindiVoices), "ar", voices(arabicVoices));
    this.client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
  }

  @Override public boolean configured() { return !apiKey.isBlank(); }

  @Override public boolean approvedVoice(String locale, String voice) {
    return LOCALES.contains(locale) && voice != null && approvedVoices.get(locale).contains(voice);
  }

  @Override public SpeechResult synthesize(String text, String locale, String voice) {
    if (apiKey.isBlank()) return new SpeechResult(false, "SPEECH_UNAVAILABLE", locale, null, null, 0);
    if (!LOCALES.contains(locale) || text == null || text.isBlank() || text.length() > 4_000 || !approvedVoice(locale, voice))
      return new SpeechResult(false, "SPEECH_REQUEST_INVALID", locale, null, null, 0);
    long start = System.nanoTime(); requests.incrementAndGet();
    try {
      String escaped = text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
      HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint + "/" + voice))
          .header("xi-api-key", apiKey).header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString("{\"text\":\"" + escaped + "\",\"model_id\":\"eleven_multilingual_v2\"}"))
          .timeout(Duration.ofSeconds(8)).build();
      HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
      long latency = Duration.ofNanos(System.nanoTime() - start).toMillis();
      if (response.statusCode() / 100 != 2) { failures.incrementAndGet(); return new SpeechResult(false, "SPEECH_UNAVAILABLE", locale, null, null, latency); }
      return new SpeechResult(true, "OK", locale, response.headers().firstValue("content-type").orElse("audio/mpeg"), response.body(), latency);
    } catch (Exception ignored) {
      failures.incrementAndGet();
      return new SpeechResult(false, "SPEECH_UNAVAILABLE", locale, null, null, Duration.ofNanos(System.nanoTime() - start).toMillis());
    }
  }

  public long requests() { return requests.get(); }
  public long failures() { return failures.get(); }

  private static Set<String> voices(String configured) {
    if (configured == null || configured.isBlank()) return Set.of();
    return Arrays.stream(configured.split(","))
        .map(String::trim)
        .filter(voice -> voice.matches("[A-Za-z0-9_-]{1,80}"))
        .collect(java.util.stream.Collectors.toUnmodifiableSet());
  }
}
