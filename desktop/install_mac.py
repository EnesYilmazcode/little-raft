from pathlib import Path
import subprocess,json,base64

SSH=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','HostKeyAlias=192.168.50.218','hayse@192.168.50.253','sh','-s']
ROOT=Path(__file__).resolve().parents[1]
main=(ROOT/'desktop/main.cjs').read_bytes()
package=json.dumps({'name':'little-raft','version':'0.1.0','main':'main.cjs','private':True}).encode()
config=json.dumps({'origin':'http://192.168.50.211:41896'}).encode()
def encoded(data):return base64.b64encode(data).decode()
script='''set -eu
home=/Users/hayse/Games/LittleRaft
app='/Users/hayse/Desktop/Little Raft.app'
mkdir -p "$home/runtime"
if [ -e "$app" ]; then
 id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
 [ "$id" = local.littleraft.desktop ] || { echo 'Name belongs to another app; stopping.'; exit 1; }
else
 if [ ! -f "$home/runtime/electron-v45.4.1.zip" ]; then
  /usr/bin/curl -fL --retry 2 --silent --show-error 'https://github.com/electron/electron/releases/download/v45.4.1/electron-v45.4.1-darwin-arm64.zip' -o "$home/runtime/electron-v45.4.1.zip.part"
  mv "$home/runtime/electron-v45.4.1.zip.part" "$home/runtime/electron-v45.4.1.zip"
 fi
 /usr/bin/ditto -xk "$home/runtime/electron-v45.4.1.zip" "$home/runtime/unpacked-45.4.1"
 mv "$home/runtime/unpacked-45.4.1/Electron.app" "$app"
 /usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier local.littleraft.desktop' "$app/Contents/Info.plist"
 /usr/libexec/PlistBuddy -c 'Set :CFBundleName Little Raft' "$app/Contents/Info.plist"
 /usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName Little Raft' "$app/Contents/Info.plist" || true
fi
mkdir -p "$app/Contents/Resources/app"
printf '%s' MAIN_DATA | base64 -D > "$app/Contents/Resources/app/main.cjs"
printf '%s' PACKAGE_DATA | base64 -D > "$app/Contents/Resources/app/package.json"
printf '%s' CONFIG_DATA | base64 -D > "$app/Contents/Resources/app/config.json"
codesign --force --deep --sign - "$app" 2>&1
echo MAC_APP_INSTALLED
'''
script=script.replace('MAIN_DATA',encoded(main)).replace('PACKAGE_DATA',encoded(package)).replace('CONFIG_DATA',encoded(config))
result=subprocess.run(SSH,input=script.encode(),capture_output=True)
print(result.stdout.decode(errors='replace'));print(result.stderr.decode(errors='replace'))
raise SystemExit(result.returncode)
