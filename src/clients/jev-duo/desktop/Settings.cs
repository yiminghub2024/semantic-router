using System;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace JevDuo {
  class EndpointForm : Form {
    readonly TextBox alias=new TextBox(), model=new TextBox(), url=new TextBox(), key=new TextBox(),
      desc=new TextBox(); readonly CheckBox image=new CheckBox {Text=L.Text("Images"),AutoSize=true},
      video=new CheckBox {Text=L.Text("Video"),AutoSize=true};
    readonly NumericUpDown budget=new NumericUpDown {Minimum=512,Maximum=16777216,ThousandsSeparator=true};
    readonly ComboBox protocol=UI.Combo(); readonly bool isDecision; public Endpoint Result;
    public EndpointForm(Endpoint e,bool decision,bool local) {
      isDecision=decision;
      UI.FormStyle(this,decision?L.Text("Edit decision service"):L.Text("Edit generation model"),560,decision?305:460);
      FormBorderStyle=FormBorderStyle.FixedDialog; MaximizeBox=false; MinimizeBox=false;
      StartPosition=FormStartPosition.CenterParent;
      var grid=UI.Table(2); Controls.Add(grid);
      grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,112));
      grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      alias.Text=e.alias; model.Text=e.model; url.Text=e.baseUrl; key.Text=e.apiKey;
      key.UseSystemPasswordChar=true; desc.Text=e.description;
      image.Checked=e.inputs.Contains("image"); video.Checked=e.inputs.Contains("video"); budget.Value=e.textBudgetBytes;
      protocol.Items.Add("systemone"); if(local) protocol.Items.Add("chat");
      protocol.SelectedItem=e.protocol; if(protocol.SelectedIndex<0) protocol.SelectedIndex=0;
      if(!decision) Row(grid,L.Text("Model alias"),alias);
      Row(grid,L.Text("Model ID"),model); Row(grid,"Endpoint",url); Row(grid,"API Key",key);
      if(decision) Row(grid,L.Text("Decision protocol"),protocol);
      else {
        Row(grid,L.Text("Routing description"),desc);
        var modes=new FlowLayoutPanel {AutoSize=true};
        modes.Controls.Add(UI.Label(L.Text("Text"))); modes.Controls.Add(image); modes.Controls.Add(video);
        Row(grid,L.Text("Supported inputs"),modes); Row(grid,L.Text("Text budget (bytes)"),budget);
      }
      var actions=new FlowLayoutPanel {FlowDirection=FlowDirection.RightToLeft,Dock=DockStyle.Fill,AutoSize=true};
      var ok=UI.Button(L.Text("OK"),true); var cancel=UI.Button(L.Text("Cancel")); cancel.DialogResult=DialogResult.Cancel;
      actions.Controls.Add(ok);actions.Controls.Add(cancel);grid.Controls.Add(actions,0,grid.RowCount);
      grid.SetColumnSpan(actions,2); AcceptButton=ok;CancelButton=cancel;
      ok.Click+=(s,a)=>Save();
    }
    static void Row(TableLayoutPanel g,string caption,Control c) {
      int i=g.RowCount++; g.RowStyles.Add(new RowStyle(SizeType.AutoSize)); c.Anchor=AnchorStyles.Left|AnchorStyles.Right;
      c.AccessibleName=caption;
      g.Controls.Add(UI.Label(caption),0,i);g.Controls.Add(c,1,i);
    }
    void Save() {
      Uri uri;
      if(string.IsNullOrWhiteSpace(model.Text) || (!isDecision && string.IsNullOrWhiteSpace(alias.Text)) ||
        !Uri.TryCreate(url.Text.Trim(),UriKind.Absolute,out uri) || (uri.Scheme!="http"&&uri.Scheme!="https") ||
        uri.UserInfo!="" || uri.Query!="" || uri.Fragment!="") {
        MessageBox.Show(this,L.Text("Enter a model name and HTTP(S) API base URL, such as http://127.0.0.1:8000/v1."));return;
      }
      Result=new Endpoint { alias=alias.Text.Trim(),model=model.Text.Trim(),baseUrl=url.Text.Trim().TrimEnd('/'),
        apiKey=key.Text.Trim(),description=desc.Text.Trim(),protocol=(string)protocol.SelectedItem,
        textBudgetBytes=(int)budget.Value,inputs=new[]{"text",image.Checked?"image":null,video.Checked?"video":null}.Where(x=>x!=null).ToArray() };
      DialogResult=DialogResult.OK;
    }
  }

  class SettingsForm : Form {
    public readonly Profile Edited; readonly Label decision=UI.Label(""); readonly ListBox workers=new ListBox();
    public SettingsForm(Profile profile) {
      Edited=Json.Decode<Profile>(Json.Encode(profile));
      UI.FormStyle(this,L.Text("Settings")+" · "+profile,670,455); MinimumSize=new Size(620,460);
      StartPosition=FormStartPosition.CenterParent;
      var g=UI.Table(1); Controls.Add(g);
      g.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      var head=UI.Label(L.Text("Decision service"));head.Font=new Font(Font.FontFamily,14,FontStyle.Bold);g.Controls.Add(head);
      var editDecision=UI.Button(L.Text("Edit decision service")); var line=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoSize=true};
      line.Controls.Add(editDecision);line.Controls.Add(decision);g.Controls.Add(line);
      var title=UI.Label(L.Text("Generation models"));title.Font=head.Font;g.Controls.Add(title);
      workers.Dock=DockStyle.Fill;workers.IntegralHeight=false;g.Controls.Add(workers);
      var bar=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoSize=true};
      var add=UI.Button(L.Text("Add model"));var edit=UI.Button(L.Text("Edit model"));var remove=UI.Button(L.Text("Remove model"));
      bar.Controls.Add(add);bar.Controls.Add(edit);bar.Controls.Add(remove);g.Controls.Add(bar);
      g.Controls.Add(UI.Label(L.Text("Leave the key blank to reuse the decision key for the same endpoint.")));
      var footer=new FlowLayoutPanel {FlowDirection=FlowDirection.RightToLeft,Dock=DockStyle.Fill,AutoSize=true};
      var save=UI.Button(L.Text("Save settings"),true);save.DialogResult=DialogResult.OK;var cancel=UI.Button(L.Text("Cancel"));
      cancel.DialogResult=DialogResult.Cancel;footer.Controls.Add(save);footer.Controls.Add(cancel);g.Controls.Add(footer);
      for(int i=0;i<7;i++)g.RowStyles.Add(new RowStyle(i==3?SizeType.Percent:SizeType.AutoSize,i==3?100:0));
      CancelButton=cancel;
      editDecision.Click+=(s,a)=>{using(var f=new EndpointForm(Edited.decision,true,Edited.id=="local"))
        if(f.ShowDialog(this)==DialogResult.OK){Edited.decision=f.Result;RefreshList();}};
      add.Click+=(s,a)=>EditWorker(-1);edit.Click+=(s,a)=>{if(workers.SelectedIndex>=0)EditWorker(workers.SelectedIndex);};
      workers.DoubleClick+=(s,a)=>{if(workers.SelectedIndex>=0)EditWorker(workers.SelectedIndex);};
      remove.Click+=(s,a)=>{if(workers.SelectedIndex>=0){Edited.workers.RemoveAt(workers.SelectedIndex);RefreshList();}};
      RefreshList();
    }
    void EditWorker(int index) {
      var worker=index<0?Profile.Model("","","http://127.0.0.1:8000/v1","text"):Edited.workers[index];
      using(var f=new EndpointForm(worker,false,false)){
        if(f.ShowDialog(this)!=DialogResult.OK)return;
        if(Edited.workers.Where((w,i)=>i!=index).Any(w=>w.alias==f.Result.alias)){
          MessageBox.Show(this,L.Text("This alias is already in the model pool."));return;
        }
        if(index<0)Edited.workers.Add(f.Result);else Edited.workers[index]=f.Result;
        RefreshList();workers.SelectedItem=f.Result;
      }
    }
    void RefreshList() {
      decision.Text=Edited.decision.model+Environment.NewLine+Edited.decision.baseUrl;
      workers.Items.Clear();foreach(var w in Edited.workers) workers.Items.Add(w);
      if(workers.Items.Count>0)workers.SelectedIndex=0;
    }
  }
}
