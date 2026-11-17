#!/usr/bin/env python3
"""COSMOS v9.5.6.1 — guarded legal onboarding + existing OneTouch integration.

Uses the already-present v9.5.6 installer to temporarily remove/reapply only its
presentation layer, while patching the exact v9.5.5 frontend with the verified
v9.5.5 legal clickwrap UI. Does not modify Cloudflare, D1 or legal policy pages.

Commands: --mode validate|apply|rollback. Requires the exact preverified source.
"""
import argparse,base64,hashlib,importlib.util,os,subprocess,tempfile,zlib
from pathlib import Path

SOURCE=Path('cosmos-next.html')
ORIGINAL_SHA='71fb87e0e75401c92740887848cf14741556632139539194c11f5873c1a17b6e'
TARGET_SHA='69162faf83058294f179ac19492f7f7e696a74d79b5ac3b1740a3053dd60e35a'
BASE_SHA='a31063ccb5e093036425aa0a6a5cdbf03a884c60df25e1598d07aa8850363c3e'
LEGAL_SHA='63e65293cbbe135e068cb6b0ed3dfc2301c09d92902b6ee44e5eaab956b55024'
POLICY_VERSION='2026-11-13.1'
DIFF_B85=(
  'c-p;M>vG$=5&oa2K$JF=#w2B3oQq^BaeSN}pT>43a@#qR$+!>+NvKJJB_Y{5if8%`eTUBU3HrZ%lRimz0q~}a<77_i@z^9T3+(Q<H-L`g5Zd%a'
  '8j943*sXMDG7KK=?d_5AX7lUU#OXY5wd_`l?CFOtdHwnk(LaYxpD%{_8@v$i4{CHSXCp}yS<CxOuNTlX9n>bA1%7RK7|<~b$V4QA8Ve~8PNR4Z'
  'lTPrNP~T5jnjSXQsNo^UPDQ^omdItyOiPWx!om|_957ils(GRCi<UT`9-E24XRz>6%wMxxij!QJTO$ek>zpUdC(U7%zim9^{Jw|A8<F^LH(4up'
  '8xFJAEzE6>Hay0rah*+Xo+K=iPSIcC??{q>(NvOFn|L#tP*1WX{Z=;rkg_DAA=7M<8TWk_ZE%~7GTa`|gh&|yNhf3;@xRU)c|A8nc1WN~!AL*?'
  'F4wuw=$LjIb4dgK3-m-Hg4Q%<LEz1pcMZJIAcdxo-Uck1%GsdSZmmg+xl@;DGq_^6aUc?wR3N1H05U7dDCAxuYQxTd|MvIxeo4sW-~R&HOMJ9R'
  'G!Mt>VIILssRxv?-=h&3Gn^DnK^Xys(XbwQpNI($m{yHZkVCdv+6Ok}Da<++Q3^PyWxK*YhXs7f$2{P2xu&g5;##yyLSu1TX!>Z%fZ~KFVQolG'
  '2@MI&k<=keMu9&NTCTr%co8vjd@(w^7!m4uVjfACXj5LWgip9fB^MFlX^uUY{EV206TSexNhm^KASJ1!%dF8oY{nV?d%q6<1s$ODJ!J9q3tX}!'
  'OtU3&@u;<?31dVGB4>;oQZh@}WKhdIwZwVKRfCPtWXj~Ab~O%Ybd6L3Gy)N`2p|;!-X<(TI1kloL`=wtB@6BW$mo#N7w!G_GpE&ZS{=95AT;tp'
  'jn|R5379`++t*i0@|It{gZFwKc`pL)EpdH!tML90pehy{&!q%XT1WatYY1TFAA|L$Z*=2u#HX-iblB9RzDT5u$dq{^@@cXxwEtElQz0|r`i*4n'
  '{MEKqO3p_Sjf7+cz0*i0;vAcXf5`kU(=ip4nh|!%xghZjyrl6>g#_2)`tB(IN7O;dvM^uhwqB|<VGka<_VZ3DUzqTS2ElSQmXYi8l#T&f1Lc+b'
  '*o3|nj6j0E2G(&vd04~=tAD4d-1YVUl*vmTGBKC+dSftD_Vvo02ydR&8+L1dzo7=gtVer@sb(|7(c-0h;C6aoz*8EKDS`yx11?)(!zUN#?|w!X'
  'jEIj#3Xyd_4tP4_(bNzEV1w~9kRSsT0<_SXgChrovRKl{W7+(1B5r^KLIaSqi_<6b$WxHjCiL>4^A7j%fh{<@`5kPa9zxbbr)*$Zjg__r6t$~m'
  'Jdnwp^>s7E76=$ih+96ejWBn?{!Rjhk8hTze%-1rg5<4+nawA4H91>^z>XsDXkelc$5odLp*mTPfLjk(tXog2<W6v8PES!ZdvB~1m5N49S6}xS'
  'ZnX06G71Tk^CU6^P3szmUc!J2!(`n8G{O$_ZUL3s819$oxXNnI0Z^r(jzWSnRfF{~K-ZC!2?x_-bt@48vus!k)Hux<-ZqjZoH~#x&;Z7xs`AZk'
  '8K)c`jMKW$;HkXx+9Esx5BlTf*}K7?%eKGHK};hS)N&VkIBO3LZNy@k{$UgP@^SI-y#h4IpZaR7oMG6>gq}i*GC_<3LL`soU<t;{8lS8j3%i9l'
  '3|+a)r7$Cg93G;Kaw>6Y#a%1}Ji1OHfBue<?%)3^WfI>nqTRpFbk2Q9P9pa8OdX3bgfv<%$?tL^xL`%VIwRj9<U9enFE6QD(s4dzJt@&LUP~YB'
  'johIsAO)Bk9$?WB1i}Dx3u7C3!EWd%$FgnjC%OZz7{XS-pfJsI;j+x`u`H^5HUe{JmQY<2Qv`v<kIEI`DG%fKrU(GPFwYID6pvJJsSS^m@SkS3'
  '$O^)xELlJQ**KBhd5(p@bZH!8LNnumZz6yhmizy2@cwJQf0yUq>h~YAnvti~a7E++g02S`_4CjbK<O8ZU?QyJCM*;Sb}Cs|zr6VU$@$gqPkshB'
  'ykp4dWHdUxIKTREa(?nBJv5^##Wn2JvicA%qInP)SFR`58~t)z)*OMCSJ~+i^qfJ;ShpZz@F*A4UH{=MYlW9Mrs*>BDr|$)A3uatX1zd689DPe'
  'wFF_vIRC=!qm`-&s$H2qb`T)tTATVb;rp(dP-u7#zJ}$#o>L@=rL2dL(z=y)nJia@%hiiR_?ZWCKyN6AC>8U%)r7xIWz|icuUYmgWO63_p7s7>'
  'bZOaWCB2_U7w2vY0Xv#Pid$c)0Cc5iFu#Wj+a_3Cm3*D)(W4<bOu=pRtg>&k@@d<<?;3Xn0=0@Y6Rx;!KwJiAsZ6hKnSkzdAL4^VhOvIs`F@d#'
  'x>lLoI)as4#zIJ7mB#gA=p9s6-mJdGoSAD3`txV&Sj+>xdP*0pyehd&z{^i5kG3Hthe%!$tSP)Q>}#y11a(sksL6_wGN4@<_()PYPtO_inP1P6'
  ';xeQ(pi(t#2cUFkH6_+<ZUqsK2ZO58KYupE*08ZLuu(zyjtauM1Z&mhO{~MMA%}&IQWnSokQDJ>uwF*RLVzRG4|()DmcE1pc8RB<h#hUzq+)4z'
  'Wd~$-o|#5twR2xpVryAH(JD6@&(T*%e;2dIG(w)#dB9SmU*{yHaxCG~nFQ8v*78=6M@lEGk9z>T-prV;+ftn`s={yq{v1JBHl$6V+!>T%(Yc1R'
  'l6kEj<ziF8rLo$KA-NYVoSIR1$jE>c$g3&jg{)S=o9@34+l{QuGGsT(%XB7gFoGFBV>ODQT5kHRVlBv{@y1}HS6Huq{!AbtaI^CLmG#=%E4}wD'
  'P(z6>3Z&HCSm72vnDdD2FgV9gCL7el1f1jSTu9K?8ww7%ULlH^4tQ|gf9gMd`uOe9+3CBVuTIbZczStqb$s!|NuzX>fax|4&JLE&R4MZ|5#c*1'
  'Ozd_Wj}_D@N4tGsx7uW{+kWxfZk10tssc56K~<s#vQTb$GcZ3?)doaU$aoyCOtvVZ$Ok+=ikPQMF2g=R7Dr)XQ<7<RV3Hk!IF-W(eSof#70j(p'
  'qq;c>*l?2DN0t&K2oLzbnqh%Zs~MQB0l$6JMiOR^ROqe$fX8(p6hLhQ)38Kgq)0ly7VR5Y{|ZDu9MIne=Vp^EI_@*-zU<}N$BE#BhzAoA>WImN'
  'oPnzn1oq4WeMSYo9qS1ir)HS@=u5_7y51%n3?v=RL##T~hVXXcC%|9C@I9o<F}nbx&>%fZuYX`HMq8-ohR}Usw_9KcomLAB#2CWbnW;;C|6~DD'
  'eTQfDP|?;cmD5^wDXG=xdK<pSlqHD2L2>oxE@&`kE}$f=H|*?CbFguJrpJ}^qDW|sl-4<k@ZzO>RI0BZiwKx$2|;JFdyLL#n$jXqpOVMfChjAi'
  'pT6ElccAF%YYk2MH+8Fe5mC<M*H$~ivuU59>%&|<3w7pnH&vKHWMTn7X637l%BJ=nx~cNz#XZ|n<%POcD4!mfvsLDsm~9T4vW4)ZX+u&P5Seie'
  'B9VmZ&QD|XM_40Zb+ft3MI!7@p`m1^ySej9)IQ81{7aU~dT!E<JSwmIc75APv#ZYBLy(ONLL0NmM4g%4a5;lH`ns^cacxLMQo1-SiR4k))vp^}'
  'wR~FdtrUOe01&<DfB*ImtG}6itO?81wW}iPnSyI0HO5&@WmHW)=|T0DnvmPIDvGv;qW)SoljjBoCP^^Zs^nK2yUV(oN-I`x%K)%-)7#IkV@;6@'
  'JnUF!jTJisgbe}ks@1s?$(6c&)|DfV7F@C`56JX3bCtWErgqm~tFeEr<=4vGdrkcN)V~jxz)swO&L4s?Y*WQ{DQ!ERK{?8zDI|-KYk1k)75Dr3'
  'XD!wIA-@KzW_%e@Bf$>{oh&fDfgI=><Y*>rhLiQ#XtqDHAci?*tF0;=C%&>yCpsI<+`c-M2S>tG3__Qy;~R?CobMQa6|tLAc<Py`rK%x*>-c=C'
  '5-lH#BcKcZyA&<q4JvtX<i>L+DtmSdMs#(y%l&L)L`f{)5bQ@w*(~_fFr<CHrE`(ie*2({$@pGtztehAP0Lp^2tc6uo^?i(YbMoqA3#UMu}CDI'
  'J9Cy=HdX*VSn=8h5Qb^*W8vUj*R5mEtB)V8zlbpmwtj+tKtobMiG+7dmDE8qNIdz^Kht>#f0USK9ARgD`qcaQsbLpHKU!h29m`hqtvB-&55H4V'
  '+A2uky~^~Usz2MDf**{)46gbEeG`+G=j3glvc*5$*_*-{K{+g!$Wt;;rICk%bS@C5*t@cG;Cua|MSa>LLX2#w5a9By_ZaBSZM~_=EE_H8lU*ig'
  'd;?CXUKo5U!Q!F?=4`uR_&UmaU*=ui=$WI`BE2!6X_*5Vt4eAY*WW<ui~K&6W(lDQLlaRG@d12As!;;2*Mn%HR?=rkrHe*&oTPn$NWOr&lUt}_'
  'pce5MniC#fA@f_XSK5^nQ*iMR;*14cns-!aj`}f^6s#cc8^vHVX(nh1&J40K;6K&2lbS@##J_@$sk(89Uau-40o6OlF6%-)!3-@0Y{BS?2hofs'
  'Q0}vw)js$hsSFmRqx@Iv#lds?Ik>OZ%Qh5K#(h1ZaqNaz^*I4wF!Dq_pHV0eU1$ISI^%>!Ks$R)FyiA(&@Geh*tipYGyT!0k~(>tq~k$NQLKF;'
  'PqOB-hb*C!zZgm-Yzf#z_FDV#?PDGyOlTzgS)V%G=yfZ7kf_1$A>>obfDIq*9Y%D^{hJ1)GZ8}Kr+CH1`JkqX{o=Ob*S$4XH>$t#?eJEb-{mG4'
  'M2QkrqTO~oiR~$VDd2AV3St$Dlp`{G6MoD5J|LUP-hTfV2Mf#F-b?)Ho5PXbG=bzu#Ue*rsi#77UqH;C1meb7_VC-x{ut84X#z=!-%F-rT5lcL'
  'oqfCW(srM}Xk<v~wVuVd{js=pQvM6Rk0JQ8#DSK(ExT1;JgiETpG+nbC=>#b^q#c4ofqAM{tfr#tOvfR{;Un?#BYOsizgem&WtHodNlCr(CRN{'
  '#37w_eB0RAe6~HnXBgL8FMv*WabtH5aPZdc_RV7gE^eOo+TDz=8TG|YZ=bZFg>-=cd9uI1f3TB1GHb6OM*yz^lVBRG-JgKF#U+{95K^~0xFNNB'
  'L_)@0%Wdx_9j~fG4-QJCaf7?3(v=Z2IIZsUZXfeG$7fKVs>s<><tkF&Mk4#vV3mPr60qAoRPlJ~r9h;rtp1e7y;d6~S5|Rraxi&OAVy2JENnHU'
  '%31dzoMqe6U;M6cQ%dHD8-pYDXsD`Ztr|xP*y(nv>cfOgTC~+}x5wqZbhghjpBz*r^cTp<APIInoj9vT2T~L*sP*kAq~M5~1iJChJqww8+Le|h'
  '@&fr#z<u(>8~ZO=dz*-J6~K$a^O}tNkXEF?bu2i#gfFk|nhzi<Cf$D48Fy)B)nMRNI+X~q?z-}z1lxxN!X8LF_ha3DMYu|a856yhlE4y*=+K#S'
  'JEc+Tq*#L7vwCh6Jc49{%X^I?k9-gVu@qGg7y^cm{s(0FzQh'
)

def digest(value):return hashlib.sha256(value.encode('utf-8')).hexdigest()

def load_lens():
    path=Path('scripts/apply_cosmos_onetouch_v956.py')
    if not path.exists():raise SystemExit('BLOCKED: existing v9.5.6 installer missing.')
    spec=importlib.util.spec_from_file_location('cosmos_onetouch_v956',str(path))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod

def policy_preflight():
    for name in ('cosmos-terms.html','cosmos-privacy.html','cosmos-guidelines.html'):
        file=Path(name)
        if not file.is_file():raise SystemExit('BLOCKED: legal page missing locally: '+name)
        data=file.read_text(encoding='utf-8')
        if 'COSMOS_LEGAL_VERSION: '+POLICY_VERSION not in data or '<html' not in data.lower():
            raise SystemExit('BLOCKED: policy page version or HTML mismatch: '+name)

def apply_diff(source,reverse=False):
    patch=zlib.decompress(base64.b85decode(DIFF_B85)).decode('utf-8')
    with tempfile.TemporaryDirectory(prefix='cosmos-v9561-') as dirname:
        folder=Path(dirname)
        file=folder/'cosmos-next.html'
        file.write_text(source,encoding='utf-8',newline='')
        command=['git','apply']+(['--reverse'] if reverse else [])+['--']
        proc=subprocess.run(command,input=patch,text=True,cwd=folder,capture_output=True)
        if proc.returncode:
            raise SystemExit('BLOCKED: legal delta did not apply. '+proc.stderr.strip()[:600])
        return file.read_text(encoding='utf-8')

def calculate(current,lens,mode):
    current_hash=digest(current)
    if current_hash not in (ORIGINAL_SHA,TARGET_SHA):
        raise SystemExit('BLOCKED: frontend has diverged; do not overwrite newer work. Current SHA256: '+current_hash)
    if mode=='rollback':
        if current_hash==ORIGINAL_SHA:return current
        body=lens.unpatch(current)
        if digest(body)!=LEGAL_SHA:raise SystemExit('BLOCKED: target legal snapshot invalid.')
        before=apply_diff(body,reverse=True)
        if digest(before)!=BASE_SHA:raise SystemExit('BLOCKED: reversed legal snapshot mismatch.')
        result=lens.patch(before)
        if digest(result)!=ORIGINAL_SHA:raise SystemExit('BLOCKED: original OneTouch snapshot mismatch.')
        return result
    if current_hash==TARGET_SHA:return current
    body=lens.unpatch(current)
    if digest(body)!=BASE_SHA:raise SystemExit('BLOCKED: underlying v9.5.5 frontend mismatch.')
    result_legal=apply_diff(body,reverse=False)
    if digest(result_legal)!=LEGAL_SHA:raise SystemExit('BLOCKED: legal snapshot checksum mismatch.')
    result=lens.patch(result_legal)
    if digest(result)!=TARGET_SHA:raise SystemExit('BLOCKED: combined frontend checksum mismatch.')
    for required in ('cosmos953LegalStatusNeeded','cosmos953LegalGate',"/api/legal/accept",'authTermsConfirm','rights_attested','cosmosOneTouchV956'):
        if required not in result:raise SystemExit('BLOCKED: a required feature is missing: '+required)
    return result

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['validate','apply','rollback'],default='validate')
    mode=parser.parse_args().mode
    if not SOURCE.is_file():raise SystemExit('Run at the GitHub repository root.')
    lens=load_lens()
    policy_preflight()
    lens.validate_js()
    current=SOURCE.read_text(encoding='utf-8')
    result=calculate(current,lens,mode)
    print('Current SHA256:',digest(current))
    print('Target SHA256:',digest(result))
    print('Existing v9.5.6 OneTouch:', 'present' if lens.installed(current) else 'missing')
    print('Legal clickwrap:', 'present' if 'cosmos953LegalStatusNeeded' in result else 'missing')
    if mode=='validate':
        print('PASS — reversible repair validated; no file changed.')
        return
    if current==result:
        print('ALREADY IN REQUESTED STATE; no change.')
        return
    target=SOURCE.with_suffix('.v9561.tmp')
    target.write_text(result,encoding='utf-8',newline='')
    os.replace(target,SOURCE)
    print('SUCCESS:',mode,'changed only cosmos-next.html.')
    print('NEXT: verify legal acceptance in D1 and Private/Business OneTouch before enabling strict enforcement.')

if __name__=='__main__':main()
