# Optional WebView2 / WinUI host for Ballast

Use this only if you need a custom Windows `.exe`/MSIX shell. Most users should install the
PWA from Edge (see `WINDOWS_APP.md`).

## Requirements (Windows)

- Visual Studio 2022
- Workloads: .NET Desktop Development, Windows application development
- Windows App SDK (WinUI 3)
- WebView2 Evergreen Runtime

## Minimal host

1. Create a **Blank App, Packaged (WinUI 3 in Desktop)** project named `Ballast.Windows`.
2. In `MainWindow.xaml`:

```xml
<Window
    x:Class="Ballast.Windows.MainWindow"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    Title="Ballast">
  <Grid>
    <WebView2 x:Name="WebView" />
  </Grid>
</Window>
```

3. In `MainWindow.xaml.cs` (after `InitializeComponent`):

```csharp
private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
{
    await WebView.EnsureCoreWebView2Async();
    WebView.CoreWebView2.Navigate("https://app.ballastmoney.com/dashboard");
}
```

4. Copy `../public/icons/icon-512.png` into the project Assets folder and set it as the
   package logo in `Package.appxmanifest`.
5. Build → Package → Create App Packages for sideload or Store submission.

Point the navigate URL at a staging environment when testing locally.
