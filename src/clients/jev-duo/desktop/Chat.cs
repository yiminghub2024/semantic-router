using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace JevDuo {
  class ChatForm : Form {
    readonly ClientConfig config;
    readonly ComboBox language=UI.Combo();
    readonly Dictionary<Control,string> captions=new Dictionary<Control,string>();
    readonly ListBox sessions=new ListBox();
    readonly ComboBox backend=UI.Combo(), route=UI.Combo(), mode=UI.Combo();
    readonly RichTextBox transcript=new RichTextBox();
    readonly TextBox prompt=new TextBox();
    readonly CheckBox stream=new CheckBox {Text=L.Text("Stream response"),AutoSize=true};
    readonly CheckBox reason=new CheckBox {Text=L.Text("Show routing reason"),AutoSize=true};
    readonly Button send=UI.Button(L.Text("Send"),true), attach=UI.Button(L.Text("Add files")), clear=UI.Button(L.Text("Clear files")),
      setup=UI.Button(L.Text("Settings")), fresh=UI.Button(L.Text("New chat"));
    readonly Label status=UI.Label(""),filesLabel=UI.Label(""),title=UI.Label("");
    readonly List<string> files=new List<string>();
    string current; bool busy,ready;
    Profile Active {get {return (Profile)backend.SelectedItem;}}
    public ChatForm(ClientConfig cfg) {
      config=cfg; UI.FormStyle(this,"Jev Duo",1120,720); MinimumSize=new Size(890,640);
      var layout=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,Margin=Padding.Empty,Padding=Padding.Empty};
      layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,248));layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      Controls.Add(layout);
      var sidebar=new TableLayoutPanel {Dock=DockStyle.Fill,BackColor=UI.Navy,Padding=new Padding(16,22,16,16),Margin=Padding.Empty,ColumnCount=1,RowCount=4};
      sidebar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      sidebar.RowStyles.Add(new RowStyle(SizeType.AutoSize));sidebar.RowStyles.Add(new RowStyle(SizeType.AutoSize));
      sidebar.RowStyles.Add(new RowStyle(SizeType.AutoSize));sidebar.RowStyles.Add(new RowStyle(SizeType.Percent,100));
      var brand=UI.Label("Jev Duo");brand.ForeColor=Color.White;brand.Font=new Font("Segoe UI",19,FontStyle.Bold);
      sidebar.Controls.Add(brand);fresh.Dock=DockStyle.Top;sidebar.Controls.Add(fresh);
      var recent=UI.Label(L.Text("Recent chats"));recent.ForeColor=Color.LightGray;recent.Margin=new Padding(3,24,0,6);sidebar.Controls.Add(recent);
      sessions.Dock=DockStyle.Fill;sessions.BackColor=UI.Navy;sessions.ForeColor=Color.White;sessions.BorderStyle=BorderStyle.None;
      sessions.IntegralHeight=false;sessions.HorizontalScrollbar=true;sidebar.Controls.Add(sessions);layout.Controls.Add(sidebar,0,0);
      sidebar.RowCount=5;
      sidebar.RowStyles.Add(new RowStyle(SizeType.AutoSize));
      language.Items.AddRange(new object[]{"English","简体中文"});
      language.AccessibleName="Language / 语言";language.Dock=DockStyle.Top;
      language.SelectedIndex=L.Code=="zh-CN"?1:0;sidebar.Controls.Add(language,0,4);

      var body=UI.Table(1);body.Padding=new Padding(20,10,20,12);body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));layout.Controls.Add(body,1,0);
      title.Font=new Font(Font.FontFamily,16,FontStyle.Bold);body.Controls.Add(title);
      var top=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoSize=true};
      top.Controls.Add(UI.Label(L.Text("Service")));backend.Width=204;top.Controls.Add(backend);
      top.Controls.Add(UI.Label(L.Text("Mode")));mode.Width=92;mode.Items.AddRange(new object[]{L.Text("Chat"),L.Text("Yes/no decision")});mode.SelectedIndex=0;top.Controls.Add(mode);
      top.Controls.Add(UI.Label(L.Text("Model")));route.Width=125;top.Controls.Add(route);top.Controls.Add(setup);body.Controls.Add(top);
      transcript.Dock=DockStyle.Fill;transcript.ReadOnly=true;transcript.BackColor=Color.White;transcript.BorderStyle=BorderStyle.FixedSingle;
      transcript.AccessibleName=L.Text("Conversation history");
      transcript.DetectUrls=false;transcript.Margin=new Padding(3,10,3,10);transcript.Font=new Font("Microsoft YaHei UI",11);
      body.Controls.Add(transcript);
      var filebar=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoSize=true};
      stream.Checked=config.stream;reason.Checked=config.showReason;
      filebar.Controls.Add(stream);filebar.Controls.Add(reason);
      filebar.Controls.Add(attach);filebar.Controls.Add(clear);filesLabel.MaximumSize=new Size(440,42);filebar.Controls.Add(filesLabel);body.Controls.Add(filebar);
      prompt.Multiline=true;prompt.Dock=DockStyle.Fill;prompt.ScrollBars=ScrollBars.Vertical;prompt.AccessibleName=L.Text("Message");body.Controls.Add(prompt);
      var bottom=new TableLayoutPanel {ColumnCount=2,Dock=DockStyle.Fill,AutoSize=true,Margin=Padding.Empty};
      bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));bottom.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
      bottom.Controls.Add(status,0,0);bottom.Controls.Add(send,1,0);body.Controls.Add(bottom);
      for(int i=0;i<6;i++)body.RowStyles.Add(new RowStyle(i==2?SizeType.Percent:i==4?SizeType.Absolute:SizeType.AutoSize,i==2?100:i==4?84:0));
      foreach(var profile in cfg.profiles) backend.Items.Add(profile);
      backend.SelectedItem=cfg.profiles.Find(x=>x.id==cfg.selected)??cfg.profiles[0];
      PopulateModels();RefreshFiles();

      Shown+=async(s,a)=>{try{
        var saved=await Bridge.Run<List<string>>(new {action="sessions"});
        foreach(string id in saved)sessions.Items.Add(id);
        ready=true;if(saved.Count==0)NewSession();else sessions.SelectedIndex=0;
      }catch(Exception ex){ready=true;NewSession();Fail(ex);}};
      sessions.SelectedIndexChanged+=async(s,a)=>{if(!ready||sessions.SelectedItem==null)return;
        current=(string)sessions.SelectedItem;title.Text=current;files.Clear();RefreshFiles();prompt.Clear();
        try{await RenderHistory(current);}catch(Exception ex){Fail(ex);}
      };
      fresh.Click+=(s,a)=>NewSession();
      setup.Click+=(s,a)=>EditSettings();
      backend.SelectedIndexChanged+=(s,a)=>{if(!ready||Active==null)return;
        config.selected=Active.id;try{config.Save();}catch(Exception ex){Fail(ex);}PopulateModels();};
      mode.SelectedIndexChanged+=(s,a)=>UpdateOptions();
      stream.CheckedChanged+=(s,a)=>SavePreferences();
      reason.CheckedChanged+=async(s,a)=>{
        SavePreferences();
        if(current!=null)try{await RenderHistory(current);}catch(Exception ex){Fail(ex);}
      };
      attach.Click+=(s,a)=>{using(var dlg=new OpenFileDialog {Multiselect=true,Filter=L.Text("Images and videos")+"|*.png;*.jpg;*.jpeg;*.webp;*.mp4;*.webm;*.mov;*.mkv"}){
        if(dlg.ShowDialog(this)==DialogResult.OK){foreach(string f in dlg.FileNames)if(!files.Contains(f))files.Add(f);RefreshFiles();}
      }};
      clear.Click+=(s,a)=>{files.Clear();RefreshFiles();};
      send.Click+=async(s,a)=>await SendTurn();
      prompt.KeyDown+=async(s,a)=>{if(a.Control&&a.KeyCode==Keys.Enter){a.SuppressKeyPress=true;await SendTurn();}};
      FormClosing+=(s,a)=>{if(busy){a.Cancel=true;status.Text=L.Text("Wait for the request to finish before closing this window.");}};
      status.Text=L.Text("Ctrl + Enter to send");
      RememberCaptions(this);
      language.SelectedIndexChanged+=async(s,a)=>{
        L.Code=language.SelectedIndex==1?"zh-CN":"en";config.language=L.Code;
        try{
          config.Save();
          foreach(var entry in captions)entry.Key.Text=L.Text(entry.Value);
          prompt.AccessibleName=L.Text("Message");transcript.AccessibleName=L.Text("Conversation history");
          int modeIndex=mode.SelectedIndex, routeIndex=route.SelectedIndex, backendIndex=backend.SelectedIndex;
          mode.Items[0]=L.Text("Chat");mode.Items[1]=L.Text("Yes/no decision");mode.SelectedIndex=modeIndex;
          ready=false;
          for(int i=0;i<config.profiles.Count;i++)backend.Items[i]=config.profiles[i];
          backend.SelectedIndex=backendIndex;ready=true;
          route.Items[0]=L.Text("Auto route");route.SelectedIndex=routeIndex;
          status.Text=L.Text("Ctrl + Enter to send");
          if(current!=null)await RenderHistory(current);
        }catch(Exception ex){Fail(ex);}
      };
    }
    void RememberCaptions(Control parent){
      foreach(Control c in parent.Controls){
        if(c is Label || c is Button || c is CheckBox){
          string key=L.Key(c.Text);
          if(key!=null)captions[c]=key;
        }
        RememberCaptions(c);
      }
    }
    void Fail(Exception ex){status.Text=L.Text("Operation failed");MessageBox.Show(this,ex.Message,"Jev Duo",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
    void PopulateModels(){route.Items.Clear();route.Items.Add(L.Text("Auto route"));foreach(var w in Active.workers)route.Items.Add(w.alias);route.SelectedIndex=0;UpdateOptions();}
    void UpdateOptions(){
      bool chat=!busy && mode.SelectedIndex==0;
      route.Enabled=chat;stream.Enabled=chat;reason.Enabled=chat && Active.id=="vllm";
    }
    void SavePreferences(){
      config.stream=stream.Checked;config.showReason=reason.Checked;
      try{config.Save();}catch(Exception ex){Fail(ex);}
    }
    void RefreshFiles(){filesLabel.Text=String.Join("、",files.Select(Path.GetFileName));clear.Visible=files.Count>0;}
    void NewSession(){
      string id=L.Text("Chat")+" "+DateTime.Now.ToString("MM-dd HH:mm:ss");int n=1;string label=id;
      while(sessions.Items.Contains(label))label=id+" ("+(++n)+")";
      sessions.Items.Insert(0,label);sessions.SelectedIndex=0;prompt.Focus();
    }
    void EditSettings(){using(var f=new SettingsForm(Active)){
      if(f.ShowDialog(this)!=DialogResult.OK)return;
      int i=backend.SelectedIndex;var old=config.profiles[i];config.profiles[i]=f.Edited;
      try{config.Save();}catch(Exception ex){config.profiles[i]=old;Fail(ex);return;}
      ready=false;backend.Items[i]=f.Edited;backend.SelectedIndex=i;ready=true;PopulateModels();status.Text=L.Text("Connection settings saved");
    }}
    void SetBusy(bool yes){
      language.Enabled=!yes;
      busy=yes;foreach(Control c in new Control[]{send,attach,clear,setup,fresh,sessions,backend,mode,prompt})c.Enabled=!yes;
      UpdateOptions();
    }
    int renderVersion;
    async Task RenderHistory(string id){
      int version=++renderVersion;
      var turns=await Bridge.Run<List<Turn>>(new{action="history",session=id});
      if(version!=renderVersion||id!=current||IsDisposed)return;
      transcript.Clear();
      if(turns.Count==0)Append(L.Text("Enter a message or attach images and videos for this turn."),false,Color.DimGray);
      foreach(var t in turns){
        Append(L.Text("You")+(t.attachments.Count>0?"  ·  "+t.attachments.Count+" "+L.Text("attachments"):""),true,UI.Teal);
        Append(t.prompt+Environment.NewLine,false,UI.Ink);
        Append(t.model,true,UI.Teal);Append(t.reply+Environment.NewLine,false,UI.Ink);
        if(reason.Checked && t.hasRouting!=0){
          Append(L.Text("Routing details")+(String.IsNullOrEmpty(t.decision)?"":" · "+t.decision),true,UI.Teal);
          Append((t.trace??L.Text("No routing trace returned"))+Environment.NewLine,false,Color.DimGray);
        }
      }
      transcript.SelectionStart=transcript.TextLength;transcript.ScrollToCaret();
    }
    void Append(string s,bool bold,Color color){
      transcript.SelectionStart=transcript.TextLength;transcript.SelectionColor=color;transcript.SelectionIndent=10;
      using(var font=new Font(transcript.Font,bold?FontStyle.Bold:FontStyle.Regular)){
        transcript.SelectionFont=font;transcript.AppendText(s+Environment.NewLine);
      }
    }
    async Task SendTurn(){
      if(busy||!ready||String.IsNullOrWhiteSpace(prompt.Text)||current==null)return;
      bool judge=mode.SelectedIndex==1;
      if(!judge && Active.workers.Count==0){status.Text=L.Text("Add a generation model first");EditSettings();return;}
      var profile=Json.Decode<Profile>(Json.Encode(Active));
      foreach(var worker in profile.workers)if(String.IsNullOrEmpty(worker.apiKey)&&
        worker.baseUrl.TrimEnd('/')==profile.decision.baseUrl.TrimEnd('/'))worker.apiKey=profile.decision.apiKey;
      SetBusy(true);status.Text=L.Text("Waiting for the model…");
      int previewStart=-1;
      try{
        await Bridge.Run<object>(new {action=judge?"judge":"ask",session=current,prompt=prompt.Text,
          stream=!judge&&stream.Checked,showReason=!judge&&Active.id=="vllm"&&reason.Checked,
          language=L.Code,profile=profile,files=files.ToArray(),@override=route.SelectedIndex>0?(string)route.SelectedItem:null},delta=>{
            if(previewStart<0){
              ++renderVersion;previewStart=transcript.TextLength;
              Append(L.Text("You"),true,UI.Teal);Append(prompt.Text,false,UI.Ink);
              Append(L.Text("Responding"),true,UI.Teal);status.Text=L.Text("Receiving response…");
            }
            transcript.SelectionStart=transcript.TextLength;transcript.SelectionColor=UI.Ink;
            transcript.AppendText(delta);transcript.ScrollToCaret();
          });
        prompt.Clear();files.Clear();RefreshFiles();await RenderHistory(current);status.Text=L.Text("Saved to local history");
      }catch(Exception ex){
        if(previewStart>=0 && previewStart<=transcript.TextLength){
          transcript.Select(previewStart,transcript.TextLength-previewStart);transcript.SelectedText="";
        }
        Fail(ex);
      }finally{SetBusy(false);prompt.Focus();}
    }
  }
}
