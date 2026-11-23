using System.Collections.Generic;
using System.IO;
using System;

namespace JevDuo {
  static class L {
    public static string Code = "en";
    static readonly Dictionary<string,string> Chinese = Json.Decode<Dictionary<string,string>>(
      File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"src","ui.zh-CN.json")));
    public static string Text(string english) {
      string value;
      return Code == "zh-CN" && Chinese.TryGetValue(english,out value) ? value : english;
    }
    public static string Key(string caption) {
      if(Chinese.ContainsKey(caption)) return caption;
      foreach(var pair in Chinese) if(pair.Value==caption) return pair.Key;
      return null;
    }
  }
}
