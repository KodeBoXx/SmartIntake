package com.kodeboxx.smartintake.contract;
import org.junit.jupiter.api.Test;import static org.junit.jupiter.api.Assertions.*;
class CsvSafetyTests {@Test void neutralizesSpreadsheetFormulaPrefixes(){assertEquals("\"'=SUM(A1)\"",CsvSafety.cell("=SUM(A1)"));assertEquals("\"'@cmd\"",CsvSafety.cell("@cmd"));}@Test void quotesAndEscapesRfc4180(){assertEquals("\"a,\"\"b\"\"\"",CsvSafety.cell("a,\"b\""));}}
