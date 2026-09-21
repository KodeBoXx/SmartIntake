package com.kodeboxx.smartintake.speech;

/** Provider-neutral, staff-authored narration boundary. No respondent audio is accepted or persisted. */
public interface SpeechPort {
  SpeechResult synthesize(String text, String locale, String voice);

  /** Provider configuration stays server-side; callers use this only for controlled availability. */
  default boolean configured() { return false; }

  /** A provider must opt in to each locale/voice pair before a request can be sent. */
  default boolean approvedVoice(String locale, String voice) { return false; }

  record SpeechResult(boolean available, String code, String locale, String contentType, byte[] audio, long latencyMillis) {}
}
