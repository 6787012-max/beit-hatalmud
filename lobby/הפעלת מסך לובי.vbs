' מפעיל את מסך הלובי של בית התלמוד — שרת ברקע + כרום במסך מלא, בלי חלון שחור.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

' אם השרת כבר רץ (הפעלה כפולה) — פשוט נפתח את הדפדפן
sh.Run "pythonw """ & dir & "\lobby_server.py""", 0, False
WScript.Sleep 2000
sh.Run "chrome --kiosk --autoplay-policy=no-user-gesture-required --disable-features=Translate http://localhost:8484", 0, False
