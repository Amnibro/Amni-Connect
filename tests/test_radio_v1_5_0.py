from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def test_connect_radio():
    v=(ROOT/'viewer.html').read_text(encoding='utf-8')
    h=(ROOT/'index.html').read_text(encoding='utf-8')
    s=(ROOT/'server.js').read_text(encoding='utf-8')
    assert 'iceRestart' in v and 'iceRestart' in h
    assert 'chip-sig' in v and 'chipSig' in h
    assert 'wantStay' in v
    assert "app.get('/qr'" in s
    assert 'function sendRightClick' in v
    assert 'function setZoom' in v
    assert 'sendIn' in h and "type: 'input'" in h
    assert 'value="4000"' in h
if __name__=='__main__':
    test_connect_radio()
    print('ok')
