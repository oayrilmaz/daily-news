#!/usr/bin/env python3
"""COSMOS v9.3.7 — guarded actual-image header portrait repair.
Updates only cosmos-next.html from the exact verified v9.3.6 source.
"""
import base64,hashlib,json,os,subprocess,sys,tempfile,zlib
from html.parser import HTMLParser
from pathlib import Path

BEFORE='4dfd7b3662c27672dae27770a0ab36447a95490b4e55725ad9e33004ab7bd7dc'
AFTER='b6dca6ab570f2bfd570dae40af5ad5976a0304e6a3a17802a999f18da638463a'
PATCH='c-rk+TW=h<75*!<jAmw|*^w`C9PfH$D2mbuuq?x}ix!gLa%ZSrMzg~y$z5q93&@Ws(3keLuYK%$e~N!e&mlS2oz=y0gEX;W*gG8Z@bFx|bKx8wt`Ty1lo4`QO&HVRXr_3^l<H4KLQ@jPLQREw^6<-k`DP?(mXJ+S&7ClsFzH@|nvPQ#zd)*loQO>K75{+^?%&VP@9=3Zq^6l3;%nF${vKsdH<VtaY!iOn>G#R@{=we<0hvDuAB10#|NNWmW}3+p8Z(kp9ZyKV4^!6y@{3^pDBJkF#`44PF?s*vUx}h~mJo54F-dTlq+Ao4p3#LOGsP64WX=^IrHt??9W%mGHf5O(%+{HJ$z=QBfQ)E-I+kJv-02C`B&Hb|F(T$nN}ePPo)$!;39$zuMv^KdpKlyxcWItiVt81bmCmWAGPq7`t@%bKxlmklkqsnEspfN56AD)X$Ka*?#To*;yoR0X#p8Y<ufCqlrX!HZ?KoXc%A6tLDo^QRFiJ&yTH~=i8yx}vvj+b>Q%n!;wM^iQCweltfA8M!YA+^?k0-i4I;H1*J3SK_Yta#-?^&$-CtMF=RBY|FdsXrlGxP;w|7(#M35i0GG~qKfc+}Wm<TU1bF}PnFGxo<*9CoJIBKSj}X9+tWe9@2+$F2Kp4lJnU(}144#IH2fGiBsIrE<)(!B_b?p))PW{fGH^O+Jqv-Gk?xCJE2RX4d@&Fn}v-{)j{9sr^FS;iF+JQXvO-zxe9WlP@0+H9OaRn(}cWG%KUhod$PLzBqY&@?_W)o7?Os;L>qGN?2_{!$SiNFQqu);P<&?bI#5PA`eTr7BVFJ1~6uMDrjPHLQfdk`Qz@v>)jW>x3EMuXwEk{_`U|+^{23w5;&7)LjVqv0ZC0kn<^kVlT)q~SdJn>n$t7bO|e)q?NEY{7+wRi6yCH4E0~Iq&H>YY&&qz5#b|-mw5>c(7h5n@`?Cz7Kq?lTg24ncnf4rl@)Q3KKEiG@nGMT9oEJrrXC2lnrWdSCdB&qe#4|+1aLn|M1;?)!yNT~rZf}?Oz4d~D-moA9n;?~nGKg)1>|5AmBxPe7FGyv&b)Z!f7@MG4;JhQDCk43L{Z!bX`Fc`7I0sbE(5NS<niwF^MS#A@(ggv)8Id=yo(G_!IZ`9}Y?Shtyn2AcHLA#YXlyS8@q)d89`(ZaDjxf0M=$U|y8h7`NI<6R-qBhQhRQQ}l{g&DIHgKG=Sqj*U%oe?s-I7U7PXm|_Qxel6+<Z&qD6H98%ks}ttkvJy^GU+ztU2%sy`ZcF<fnpv|1e2ARc+GQ7V=hMlTxqz^}*a+Ns3=xdX!)vup<FN1pQOc$4sqFbeq7%r*iTR~ihLh!b}Nh}sK4Rb$pIQz|kFI6IJogaRnJt(%#JBeeyHkfwbFM`8#H#-L4-!br?zJWFZeFN8`)c3*t6^Ku9NdGXo_x)j6`v^?IU^7N%U#+wYN@DxQ`;f!Py3?cH2n6q(dj~@v>5VnxWyLT<G0s5MPSR1a>L^rb{0m9%9E)o_;IWR#mvdj<b948FOrtS@TT5+&v-V5P!$uf&vFzpSzgXUl?W{?D8-U!(tikBr`og*;Xltp%*buT2ZX-**c#uFioMdgKi;F-e4QaH$#){>9F)_spkPWzw^mU=-&Za)Vrs06w0H3_QF`Rir3!olLdGgelJs#0|=ntXKaF2|-Tw6}AfLn_9S2o^Pzm-84Xu!<+}3BZ2GmJfJbp_Q9!P3i@mvdCMNta`&@GEH^lc`XVFiv^}g5Jc4?i>uj*q~kHVOLRg38e7W%Rd+CTLvv;T7ruwa;st&$+PtU*Pa~m_t8I~G=Ge{`u9nT6C|VM!6Y5`POfC+f%83DTx6;)2R;KA*FFX-)2O!PQM8cv?{5O<r3Mk|EdQG|zGyq(EcfRT+MCPr`0ptku0kJtvi@4tv?3KYU*aaQDD9*yhUN+EKMy`m;Ee@{;y4Qn+*YxFvH+z4;Kn4*8;~1GPu5iHC`qeId8=7SZ4lYC%vw@Z~cG<hu;2_QjxomMaaXo8ZRZ?^Fh~aj<5z9)(rITO&tjX`q;Bff=nxeVVsQ81dOWtz?9z5Aa?|CCrg^c>AY!Tq=p*dzNPcmD>jCzK98DkaZv)%>bvVilRQJMLkO=I4^e6|1W?(?0udpqCkZoPfAv-OQ<RmPr$Q>GN`{q7wA$Ym=NZu5Di@_BjYD~xA11NWXVz`!yz)l5bU$QB_sO<83*Ho5&R$c>P~s@raIb6;P^hvM{Lq2~0@$^>iB28NHTx0=NR)@qT3*q4By3RtKke+n{m{iwGYWCIXnVFYq~X`j43h$bNb_0;c$3Tj2>-wPhVh<F2GPi_NN`jzC|4$Fue!^%^OxaDCmV{<i8b)1Tp6harV)zWQ9h>*G9NhO-+5T%S}mETOaR)}(so-!=P;owHmfr)6%L{HfFEAy&^&yCtD=lGS0*owhq|51mtk86Ik?hOh*sRE5z*}F+pu``FiIL(&s<5qMC-Zdl>D1N;Fa>WZcI151%ARd4Zx3Cwd!YHx~_65a8Ug~>?n1R$Hqgi)sGSYaaN=vXFPA(jkU?h^oU<JuqpW5V2eVpv|0z>-pDp__KP(zXzNXt=*I(6W=oXrb5(}ZW<-h#YzPepzQs0gE9yLNjy+H00QG-DBNADZoz?l@_}X(})gz{#r<2e&~r-R@(EbErS$cdz%JM}K|_c0ml0=xA+uHRj<7q&G)vq@~0Zt)Xw46q`>sfXZg!gV&HO>XKC?t<P<~|J%P>Wb-SCBJLcm0VDafY#1SGAyNek%CPp-q6N{5oWXqiw9F!A@bKF52<x|@${Dj}4*zt+uKrNsMy3_*dQYe-i#~W0pwm7B=$FJZDFFkPPEZ7b-vU^eqQ9e)0;N(41?)1!Bb_F8WI{U!Ud6-G1x^bBAeD-iBT!=sl-FmbRTcSIy0n@M*2AkNL%VZeX&7JY<n-_guRQh|w*lr=@521&%Av|aO;C-N3!kB#UQZ}IugY{$g3XtI5;NH<nTrk`S2mP~WY>rV`*j%osl<*e_D!|O`x39SOa~Ph^oH%yurr4)QshQ)*w8{u<H_nIqE-)ppzPe<MX9-BWayORj<4mSb!}r?6%jqN4N14xE66!sqAB}cM+<$UF074K4zt2Y&};2pJ-j!OY!0dSzPTxd=i*h1T}#WoyI5T!lm*f)dJAP6x>i*!+r|sA!ZM&LAtQuL+vr^|9g=O^n0^1_-@9P@{g3~^?ybAA5D;65vAk~lH5XGvv7AcCvg~D5&9(}F8ZH%ZZP_H?c$ziD(^Y*I3aBio7;(1g3QjD%dbh-b5A64J>BC)bRGo9!Oma47WP!4@%IMaZ@2y+*YbCIkF?}ZFDRDcmLmWV@m`^sqSqL3dyjm$Qnkei!VX~!<%TM{>r+lzu{!%Ok9;8SyeJY=ABNwy^gSkk#W+pXb@hRT=)vUS&Cjb1Di+=Q6wAT5t{xOsM235Sbjzx1L0AhFS!qRXbiFM^d%KgB;pP6)hlEYn+Qw4&Kwp&51I|sUKU4)%7d80(FbSSd~Q#FVzcpIr$R_<MQ`{nDS!wxGru3a6CqRmk#GSire%w>ZkKWg1Fz~UWPJG8unbDGW=9??A;0`+3Rjd%2bjNy5K$;}(r8&*De;>fMW-|AU-c<*?Kfe#<MlV3bmJE^h^+oTFt2KHnPtFh~Pt#xlq=&8b_T^QKO!EH2Wq8!M(+O#dd8Z*l&Ts;B1jd!?{1}yEeGpFIoe4kxYA`Di%H&}AqNazYrWa-U43)AT~OW;u*&QvuqfBk6DXfR$=u?{~0%r6^YmOR<^tA9q^se0X?eYWgvA7E^?3g{E2{S-`F%7JXA8hwbq8!Z9Dv?bQ6>D>2BnfoO3gi9zdyro_MHZLqolBpbiFlVtR3`<j_AK>?zZnT&b;+S8Tpwo1o&?}t?KkNGz%eF(La2$BXUTsnxexHxM-~#hc{3v}C;xDKt%?UQX&)L|!>;+Arx2m(dUKiu-6|0>aSfMSS02l=0ym`o3VXUoq@NrGm@^}+#wKFS&T@F(#dwSJvc!zz}ue`nOvT<O(mB9|4tFGKPbVbx_UQ&MYg#Vo<)FAj);piF{sYjT$DSc3UsYRGi4)`-U;PLT)0USo*U;'
mode=sys.argv[1] if len(sys.argv)>1 else 'validate'
if mode not in ('validate','apply'):
    raise SystemExit('Usage: python scripts/apply_cosmos_avatar_v937.py validate|apply')
path=Path('cosmos-next.html')
if not path.is_file():
    raise SystemExit('SAFE STOP: cosmos-next.html is not at repo root.')
original=path.read_text(encoding='utf-8')
digest=hashlib.sha256(original.encode('utf-8')).hexdigest()
if digest==AFTER:
    print('PASS: v9.3.7 already installed; nothing to change.')
    raise SystemExit(0)
if digest!=BEFORE:
    raise SystemExit('SAFE STOP: Unexpected frontend SHA256 '+digest+'; expected original v9.3.6. Nothing changed.')
edits=json.loads(zlib.decompress(base64.b85decode(PATCH)).decode('utf-8'))
updated=original
for old,new in edits:
    if updated.count(old)!=1:
        raise SystemExit('SAFE STOP: a v9.3.6 avatar anchor changed; nothing changed.')
    updated=updated.replace(old,new,1)
if hashlib.sha256(updated.encode('utf-8')).hexdigest()!=AFTER:
    raise SystemExit('SAFE STOP: output SHA mismatch; nothing changed.')
for marker in ('COSMOS v9.3.7','cosmos937-portrait-thumb','cosmos937ExplainPortrait',
  'COSMOS v9.3.6','COSMOS v9.3.5','cosmos934CleanCanvasJpeg',
  'cosmos933Upload','cosmos933EditPhoto','/api/identity-media/',
  '/api/business/jobs/discover','cosmos936-business-brand'):
    if marker not in updated:raise SystemExit('SAFE STOP: missing preserved feature '+marker)
class InlineScripts(HTMLParser):
    def __init__(self):super().__init__();self.active=False;self.text='';self.blocks=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and 'src' not in dict(attrs):self.active=True;self.text=''
    def handle_data(self,data):
        if self.active:self.text+=data
    def handle_endtag(self,tag):
        if tag=='script' and self.active:self.blocks.append(self.text);self.active=False
parsed=InlineScripts();parsed.feed(updated)
if len(parsed.blocks)!=4:raise SystemExit('SAFE STOP: expected 4 inline scripts.')
with tempfile.TemporaryDirectory() as td:
    for n,code in enumerate(parsed.blocks):
        f=Path(td)/(str(n)+'.js');f.write_text(code,encoding='utf-8')
        checked=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
        if checked.returncode:raise SystemExit('SAFE STOP: inline script syntax error '+checked.stderr[:500])
print('PASS: SHA256 guard, avatar logic, preserved COSMOS features, four JS scripts.')
if mode=='apply':
    tmp=path.with_name('.cosmos-v937-tmp.html');tmp.write_text(updated,encoding='utf-8');os.replace(tmp,path)
    print('APPLIED: updated cosmos-next.html only; no Worker or SQL changes.')
else:
    print('VALIDATE: source unchanged.')
