using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace JevDuo {
  public class Endpoint {
    public string alias {get;set;}
    public string model {get;set;}
    public string baseUrl {get;set;}
    public string apiKey {get;set;}
    public string description {get;set;}
    public string protocol {get;set;}
    public string[] inputs {get;set;}
    public int textBudgetBytes {get;set;}
    public override string ToString() { return alias + "   ·   " + model; }
  }
  public class Profile {
    public string id {get;set;}
    public Endpoint decision {get;set;}
    public List<Endpoint> workers {get;set;}
    public override string ToString() {
      return id == "local" ? L.Text("Local decision model") : id == "typesafe" ? "TypeSafe Jev" : "vLLM · System Duo";
    }
    public static Endpoint Model(string name, string id, string url, params string[] modes) {
      return new Endpoint {alias=name,model=id,baseUrl=url,inputs=modes,textBudgetBytes=16000,
        protocol="systemone",description=name,apiKey=""};
    }
    public static Profile Create(string id) {
      bool duo = id == "vllm";
      var dec = id == "local" ? Model("decision","kev-latest","http://127.0.0.1:8009/v1","text")
        : duo ? Model("decision","vllm-sr/d3-flash","https://app.vllm-sr.ai/v1","text")
        : Model("decision","jev-latest","https://api.typesafe.ai/v1","text");
      var workers = new List<Endpoint>();
      if (duo) workers.Add(Model("auto","vllm-sr/auto",dec.baseUrl,"text","image"));
      return new Profile {id=id,decision=dec,workers=workers};
    }
  }
  public class ClientConfig {
    public string language {get;set;}
    public bool stream {get;set;}
    public bool showReason {get;set;}
    public string selected {get;set;}
    public List<Profile> profiles {get;set;}
    public static readonly string Folder = Environment.GetEnvironmentVariable("JEV_SETTINGS_DIR") ??
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"JevDuo");
    static string FilePath { get { return Path.Combine(Folder,"profiles.dpapi"); } }
    public static ClientConfig Load() {
      if (!File.Exists(FilePath)) return new ClientConfig {selected="vllm",profiles=new List<Profile>{
        Profile.Create("vllm"),Profile.Create("typesafe"),Profile.Create("local")}};
      byte[] clear = ProtectedData.Unprotect(File.ReadAllBytes(FilePath),null,DataProtectionScope.CurrentUser);
      return Json.Decode<ClientConfig>(Encoding.UTF8.GetString(clear));
    }
    public void Save() {
      Directory.CreateDirectory(Folder);
      string tmp = Path.Combine(Folder,Guid.NewGuid().ToString("N")+".tmp");
      try {
        File.WriteAllBytes(tmp,ProtectedData.Protect(Encoding.UTF8.GetBytes(Json.Encode(this)),null,DataProtectionScope.CurrentUser));
        if (File.Exists(FilePath)) File.Replace(tmp,FilePath,null); else File.Move(tmp,FilePath);
      } finally { if(File.Exists(tmp)) File.Delete(tmp); }
    }
  }
  static class Json {
    static JavaScriptSerializer Codec() { return new JavaScriptSerializer {MaxJsonLength=int.MaxValue}; }
    public static string Encode(object value) { return Codec().Serialize(value); }
    public static T Decode<T>(string value) { return Codec().Deserialize<T>(value); }
  }
  public class Turn {
    public int hasRouting {get;set;}
    public string decision {get;set;}
    public string trace {get;set;}
    public string prompt {get;set;}
    public string reply {get;set;}
    public string model {get;set;}
    public List<Dictionary<string,string>> attachments {get;set;}
  }
  class Response<T> { public T value {get;set;} public string error {get;set;} public string delta {get;set;} }
  static class Bridge {
    public static async Task<T> Run<T>(object request, Action<string> onText=null) {
      string root = AppDomain.CurrentDomain.BaseDirectory;
      var info = new ProcessStartInfo(Path.Combine(root,"runtime","node.exe"),"\"desktop/bridge.mjs\"") {
        WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true, RedirectStandardInput=true,
        RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,
        StandardErrorEncoding=Encoding.UTF8
      };
      using (var child = Process.Start(info)) {
        var errors = child.StandardError.ReadToEndAsync();
        byte[] json = Encoding.UTF8.GetBytes(Json.Encode(request));
        await child.StandardInput.BaseStream.WriteAsync(json,0,json.Length);
        child.StandardInput.Close();
        string line;
        while ((line = await child.StandardOutput.ReadLineAsync()) != null) {
          var response = Json.Decode<Response<T>>(line);
          if (response.delta != null) {
            if (onText != null) onText(response.delta);
            continue;
          }
          await errors;
          if (response.error != null) throw new Exception(response.error);
          return response.value;
        }
        throw new Exception(L.Text("The inference process exited early. Extract the entire application before starting it."));
      }
    }
  }
  static class UI {
    public static readonly Color Ink=Color.FromArgb(29,43,54), Teal=Color.FromArgb(0,104,99),
      Navy=Color.FromArgb(26,46,58), Paper=Color.FromArgb(246,248,248);
    public static Button Button(string text, bool primary=false) {
      var b = new Button {Text=text,AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,
        FlatStyle=FlatStyle.Flat,BackColor=primary?Teal:Color.White,ForeColor=primary?Color.White:Ink,
        Padding=new Padding(9,4,9,4),Margin=new Padding(3),Cursor=Cursors.Hand};
      b.FlatAppearance.BorderColor=primary?Teal:Color.FromArgb(200,211,215); return b;
    }
    public static Label Label(string text) {
      return new Label {Text=text,AutoSize=true,Anchor=AnchorStyles.Left,ForeColor=Ink,Margin=new Padding(3,7,6,7)};
    }
    public static ComboBox Combo() { return new ComboBox {DropDownStyle=ComboBoxStyle.DropDownList,Width=160}; }
    public static void FormStyle(Form f,string title,int w,int h) {
      f.Text=title; f.Font=new Font("Microsoft YaHei UI",9.5f); f.ForeColor=Ink;
      f.BackColor=Paper; f.AutoScaleMode=AutoScaleMode.Dpi; f.ClientSize=new Size(w,h);
      f.StartPosition=FormStartPosition.CenterScreen;
    }
    public static TableLayoutPanel Table(int cols) {
      return new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=cols,Padding=new Padding(14),BackColor=Paper};
    }
  }
  static class Program {
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [STAThread] static void Main() {
      SetProcessDPIAware(); Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
      try {
        var config=ClientConfig.Load();
        L.Code=config.language=="zh-CN"?"zh-CN":"en";
        Application.Run(new ChatForm(config));
      }
      catch(Exception ex) { MessageBox.Show(ex.Message,"Jev Duo",MessageBoxButtons.OK,MessageBoxIcon.Error); }
    }
  }
}
