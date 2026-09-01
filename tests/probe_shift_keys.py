"""Drive the real input daemon and report what a real Windows app actually received.

The viewer sends the SHIFTED character (`e.key` is 'A', not 'a') and holds Shift around it. enigo
0.2.1 resolves a char with `VkKeyScanW` and then passes the WHOLE return value - virtual key in the
low byte, required shift state in the HIGH byte - into `MapVirtualKeyW`, which only accepts a
virtual key. 'A' -> 0x0141 -> MapVirtualKeyW returns 0 -> InputError::Mapping -> nothing is sent.
Every capital and every shifted symbol is dropped on the floor.

Focus a text field on the machine running this, then:
    python tests/probe_shift_keys.py            # print what landed, per case
The observer is whatever has focus; pair it with CDP reading input.value for an exact answer.
"""
import json,socket,sys,time
HOST,PORT=("127.0.0.1",7878)
def send(evs,gap=0.06):
    s=socket.create_connection((HOST,PORT),timeout=5)
    try:
        for e in evs:
            s.sendall((json.dumps(e)+"\n").encode())
            time.sleep(gap)
    finally:
        s.close()
def viewer_seq(ch):
    """Exactly what viewer.html emits for a physical Shift+<key>: e.key IS the shifted char."""
    return [{"type":"key-down","key":"Shift","code":"ShiftLeft"},
            {"type":"key-down","key":ch,"code":"Key"+ch.upper() if ch.isalpha() else ""},
            {"type":"key-up","key":ch,"code":"Key"+ch.upper() if ch.isalpha() else ""},
            {"type":"key-up","key":"Shift","code":"ShiftLeft"}]
def bare(ch):
    return [{"type":"key-down","key":ch},{"type":"key-up","key":ch}]
CASES=[("lowercase abc  (control)",bare("a")+bare("b")+bare("c")),
       ("SHIFT + A B C",viewer_seq("A")+viewer_seq("B")+viewer_seq("C")),
       ("SHIFT symbols ! @ ?",viewer_seq("!")+viewer_seq("@")+viewer_seq("?")),
       ("bare uppercase D (no Shift sent)",bare("D"))]
if __name__=="__main__":
    only=sys.argv[1] if len(sys.argv)>1 else ""
    for name,evs in CASES:
        if only and only not in name:continue
        print("SEND "+name,flush=True)
        send(evs)
        time.sleep(0.35)
    print("done",flush=True)
