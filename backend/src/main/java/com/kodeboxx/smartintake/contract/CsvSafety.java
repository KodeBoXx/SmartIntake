package com.kodeboxx.smartintake.contract;
/** RFC4180 quoting plus spreadsheet formula neutralization. */
public final class CsvSafety {
 private CsvSafety(){}
 public static String cell(Object value){String s=value==null?"":String.valueOf(value);if(!s.isEmpty()&&"=+-@".indexOf(s.charAt(0))>=0)s="'"+s;return "\""+s.replace("\"","\"\"")+"\"";}
}
