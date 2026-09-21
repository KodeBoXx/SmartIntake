package com.kodeboxx.smartintake.speech;

/** Provider-neutral, staff-authored narration boundary. No respondent audio is accepted or persisted. */
public interface SpeechPort {
  SpeechResult synthesize(String text, String locale, String voice);
  record SpeechResult(boolean available, String code, String locale, String contentType, byte[] audio, long latencyMillis) {}
}
