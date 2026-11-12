#!/usr/bin/env python3
"""COSMOS v9.4.9 guarded Personal/Business Metro parity patch.

Updates only cosmos-next.html. Requires the exact installed v9.4.8 source.
Does not touch Cloudflare, D1, user data, discovery, or publishing automation.
"""
import argparse,base64,hashlib,pathlib,subprocess,tempfile,zlib,sys
SOURCE_SHA='079e7abed5db175b691c49aa166eed0cdda1e407ae1ca499bd005f731fa30f0e'
TARGET_SHA='d42e0bbc91fd75505c57c554ce9cc7f74b29f83eefb75654190a7bb08a75cb65'
PATCH_B85=(
    'c-p;K-FDkH62A9SAc`B3l}Jf;oWztV+eveF&)GQ1soRU)#9KooB(ebs764@_s-'
    'A1_`(z#bP@*K;Nm`$^eJm0`GlQ9LKFrAXeT2I)6FC!pL1r>YWls0n?KT?i4xgPN|M>8r*LjZG_Ves)51F5nQ6(iSkert!YMGZ7O0dMf5p?|YxnEKo6C'
    'Va)$^K$giL4+(oI3TB6FMc~f)$uL%hs@s-Vi(`2&0_kq>xC-Pcs2x=O<mGW4JOv<e1Xod!<5bZ6QbyN@7V86k|$?1al>0fC`2{o@6|Oag?%(BM?8vBQ'
    '*fagOjci3!kt*1AW&6qmdI?@dBj;Cs{FZulE;Z3JOI4@+UG~qUHf_82{vic7XuP+*vf71;3Qlh-UFGB*~Nwn0lwqt9O?d?=Ha;oG35Yb8JbEqNsoBz#'
    ';)F{`emfH(5zgRU!rlV>boD#r!5EoTy2O%auQ_z4o4O9Cm$@WK$GVEJW1GiR26-'
    'GxtTz8Ko#@d5L4`7tEjFQnXN(*i}E^`K4Kd!DOG}5us7*2b|G4dZj~+F4VdJUEXC?M}>uC5Eza`mcYAY$SRg8XVoON_KKi2+-'
    'pCO!L9$B#i;&inoP4PAVu38r<hAX2qj|)@aMRQQ(wJ6NbMWXCaH83j6_u^z^jN$UKO7pB{8?F&D=0L+L$wYLkE%w2|1^bZoXfqfHpuc4)+)O^L;Fr-'
    '!-ki)o#7ix-iX>gcMN=#z+g216B_K@7i)Af?ruyxQ^p30k(N5=k+H<;vW@wZ)tXz|0bc9nqK<7!~Rj{;1IRVQ~$tF%(yCa_5qeB6O#N$Ch#KMnYXZMc'
    '+NSV2bs{H?kwPDg?GAo48|FiguByds5pv^(G;@C5t75<oF`AZ|NU_8|L1CP&^cW0cLPa;bf=ydez+Pen-'
    '&N>CO>nkbW1*8#2{LtDk{hg`uWE<?yN%@PzS6GAfqQ);SH>bl^p=BTT7JkkKNxsb|nXH5+A!0%0`&_AF%(q=O6o5?T?y)YqP4L#4;^#PP`{i9#w&Wn8'
    '&GpOtDB$*YjafQ94+Hwm7X_WrjA+RF#U8-'
    ')k~*y@h57b1)%s{3(L}6B7JZ5k9}vC}P}o0?X?M$3DymCCKqkgP1a*jC6u+ygS|?8@rFRNY5BEXsC)YPek+~2m-'
    'xgQ{6eGcWAuQLiJ`#j<?BXg~Y(cJTkIN44#&+DNz|~1k@`wc5lpVJ0KJ>1GX5VhFylxeS<Z}v%Xv(QIZM7oQS9@G7#q)yK`K+aWsqrbzcf1*8*Re9dp'
    'kcY)G=8-V`&YSY8-W?k%!x*8KiEWM&{rnn92{@Msg`C1aG}!rN9g!aPb?Tq#!tG2BX$SjV{z<S#@ORs@<W-'
    'U8$z=Pqy5V%74j0Ehnbr;9hy^$DaPD<(q&KU7CnsH<y#(F`omhFyE2Ieb`q=frTEDL0HZ-}-'
    't!JYl5<`4rO%h!Ae`*6>`>HY>AOoOI3fP^qe;qXPm&alN${XiUVw3Q(J@9#;acy*2NtazR-'
    'H6lW~0FI{W+B~%(Qu~EFudNTv(ui49ZK;QXECh&+tEh96jsQoQNQ^K=x219lq<f}lLDSdPhL<*B*LXwuVyxSw1Tx)DKJX0I-'
    ';BNVH)d(n3<d#i|Hc|1ESk->l4W!x}%?d%dd`ZTP6Bm%yF?7?!-'
    'c}laxD7Q|kQe534OC=BOsj+lmjnFs5tIeVDnCzm$3h1@>wK+d<Kwm7+UK_@HHq9*X-0Mx;v{*k>c%%v<Pva?>i`oM6XJA8G+Y3?kw9WT0hY+s6#-'
    'iAbceTlz-YBwn_Mf_wD|?WtJ8Yhhu9X1%aYDr9mNhD$r~)c9Lyc;D7P|jWCoWRaCUKShK-=5{@>K|w<v$0>(y=-'
    'O^<`8!EuNzv8{^y2E}0te45OWy7!^7v>AJOe(_o(J*h?M@)U7)16$y)k|{{~47pmjORM4&{R9FSO+c2qd66+oxvG|BC_I6d09qPWBpvk9_9;GK4Xn~w'
    'k*LH4ff~O^5D<>;+!Qr5RMi6iMMzm+ZF9ZBvXIdYH2`||_RYUH_^8SAHbzFCxpQ*x{_R!AV_ni;z`SEUt=692UoC8fC;)PJjpNjXHeg67RERm75?6&z'
    'p`lS2ZG&&Iw{e+A-%KYR<C^Fj*<fI*<NjgquyX{(asS}>p!2L}`|tXsPhUX!4-'
    'i?sANs02^>J(*ZCG=W12j^iT7>ZMML8Rkz!DIo5S~%LSI!<~dC9oMg#=%~pSpFShk!n8uYIB)b#GNGIexXm%!O^YglgKl-y_q@t`ngKtHMYPI#dZ_T6'
    '8EL4C?FNT@Y|l5nE*J)CUkY2t5+|F7;_vd|GV<sXC!RZpIOuzq0Lp2U>oq#VPnh83_8I5?~YpqMAP2(i!ZJh`b@hpjH{C?N%?VWc$9m*M1Bj2~0Z*6)'
    '!<+gx<*#Xkl||9u}-1YljcO-'
    '}eX{2J5!he(}(O^>DcZUDn?=_&G~3HE3FmNj$RMaO(;^u7@w~5sVhfO^kyZ!+x(};$Hi!Z8Y9|coS`u8WtXGT8Pk1mdF$g?|rv5F=8`cWS<q_M|!UhB'
    'U@`48L}<cCJStWT*|}#i*ok$zFBAHQ4I(Sb$yf?6C>ykKmA3s&AGR&9#b+4`v`t_9df6qay;|zndH#9hP{V4{1AyM2Z3|rhQAd$JHY|Nl?eL><vp=|_'
    'H1Vs(`-`snIyRgW3Y|z2RL9jhW1H-FJ%g=3~DP0ghfKI4+xBA33_~V^!)jY@xadbY&?eUO)dBfdJ_Wm3l&xubO&R~Zu}dL%dq}N>s!vX-'
    'N`>pM(@fs_BJBaKkDt~7hEj5<XBxAoQP80L0~l;RqF3@4Miv(14WRmDclIKfD2-2`z(io3?p}q@@Gn!XKZ)?7;i#t7l<n^3H$w>n^&(`ezPSTac?N-'
    'DFp|&DS*G#{SG(%h$VCVpuTS!?)?dJxJ*3'
)
parser=argparse.ArgumentParser()
parser.add_argument('--mode',choices=('validate','apply'),default='validate')
args=parser.parse_args()
path=pathlib.Path('cosmos-next.html')
if not path.is_file():raise SystemExit('ERROR: cosmos-next.html is missing from repository root.')
original=path.read_bytes()
current=hashlib.sha256(original).hexdigest()
if current==TARGET_SHA:
    print('COSMOS v9.4.9 already installed; no file changes required.');sys.exit(0)
if current!=SOURCE_SHA:
    raise SystemExit('ERROR: unexpected source hash '+current+'. This patch requires the exact v9.4.8 frontend. No files changed. Review the complete HTML/backup rather than forcing an overwrite.')
patch=zlib.decompress(base64.b85decode(PATCH_B85)).decode()
with tempfile.TemporaryDirectory() as d:
    patchfile=pathlib.Path(d)/'cosmos-v949.patch'
    patchfile.write_text(patch)
    check=subprocess.run(['git','apply','--check',str(patchfile)],capture_output=True,text=True)
    if check.returncode:
        raise SystemExit('ERROR: patch verification failed; no files changed: '+check.stderr.strip())
    print('Verified v9.4.8 frontend SHA-256 and v9.4.9 patch.')
    if args.mode=='validate':
        print('VALIDATION GREEN. No files modified.');sys.exit(0)
    applied=subprocess.run(['git','apply',str(patchfile)],capture_output=True,text=True)
    if applied.returncode:
        raise SystemExit('ERROR: patch apply failed; review the GitHub run log. '+applied.stderr.strip())
    newsha=hashlib.sha256(path.read_bytes()).hexdigest()
    if newsha!=TARGET_SHA:
        path.write_bytes(original)
        raise SystemExit('ERROR: target hash mismatch; original restored.')
    print('APPLIED COSMOS v9.4.9 with SHA-256 '+newsha)
