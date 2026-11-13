#!/usr/bin/env python3
"""Guarded, frontend-only COSMOS v9.5.3 Personal & Business parity installer."""
import argparse,base64,zlib,hashlib,subprocess,tempfile,pathlib,sys
SOURCE='e019a95b49386a2caa79b62fa194f5ea615ab410afd3ec7d55d05d10c3b91814'
TARGET='6ed9e44409e20b721f39a12020248b9760aa4687c7575353edd9ec24a2f50c9b'
DIFF='c-pmE{c_v55&z#$fhLnkIuo)eOSVPFj@xUdGo4A3*6GKL$J2pGNJLB$JOGre^LeHZ(U<5G^#Arv`XpTdq(o8FhZW`K9FYLA0Cs=-+g*?tV?<7TE@LinLLXH-RB?24e0+?CtIanz2)mtb@4`7l$M(YQqMMr|RQ%U&x0_Qg9^T*GHNNtpY&ebI!w-6k6p3h};Qmue6C`*<rGvzO|0S~+{y`)OP{;&J#*O=X@9w_kEQH=QVj>=>N+aUahGXP6ev?U-P$|*JQlHoOOoikLiI$r4A)f^w!3bvhBPJEhCd*^yZTH3G_s`DJvAui>DG8w0Yuu6%RWrROkxAGRhaGt%5=rVXMPupR6=U?;6&118!x#OF_z2xnF=0MM|M@rac?=Sf<UD~VK4-&-`9#425s1{2H5{0O-aBQ1sbCZ0&-4I$g+6l_H``m_IAZ~gv^HVPk35dEgu(uPH*elsvY;s!+US2W7l<Hfb?5WMry?=)C5re8sgR-{Kiz)(bc;v;Q-LW2QCxs6ju*B-Ra<;`OsQZLq-l^vbZj(JW04Y?6dzNVP87KKlHcoX&ap70iU2m|eYYtfNft_16v>bX8X##ACDD|r5E0*}se<OY9N1|>eXS^I=eu7*HWzHnbXVh(xq=Z^3%Vr=U}8ZfCBhF8op1FL@l+WYgLZPKyg1FB@?zk)?%XM#?GGC@6B5&_tE(knYCT2VTCq)F8{?$OCsaga)((gwlB%}lfIlY;+9mzVpxf6nhPm@K-Zu)Cuwrr1V+aHESLsf3wb<^~rJyPk$>r)Qf6Az|N^3n$SrYJRzLY_Cpc&+kdH=6LGqASz?Pf{XaYa}T!_sa;K}T8@EK=Mvc)Lkepm+dV2c*B3+3+h^?aJEXO}Arx9xg1B8|x>t{{G7^#eLzfi<XkVwVn!e15TtuDN&)kdNMK=$}_iCWlk<`(U~{o-3!@^Cl+n?q36qD(p<CJU7BX<JH5txr}6h;M3M)<V8V4L6;8rIWmE`oo4KZ~nA~`F10fK31V+AEGTKL~1iuYIaek&Gpy>2+Zt-Ho+qY_#QsBp;!LCIsY?LL&gBq>nKCrnK^9(=63*588nbQX^aL+sEj@$3#Zt!fVNk9DDGGpGINMEp2T^}94lWG=G#Dc3=Il%g-U*Ku8<j+I^6TX7SPJSrZX)<W{+o$M%|M(~R^oI`!oP}pf?;iLHc#QahLsXjkzYc6gtZEyD{gp&fO0*}KPM{2)B?@VeLsF3$P)bUG`@qdXBYZ4K8qOT#6A{=Euy!6rC??7e+vtarqvO{kP1~_vF^<3+Q2Q$f`_LH%d1DHc{91+-yt(jB90Ss$J3ZyxW3eK`t5-(It9#To126;f63Bpb$RDv}KWo+<askYQq2*UB*6u(OWx$}>V-)czo_Qowywp4IdGtaS1T?9Pw0puS2{f;RXr*}U`6Tk2Znu*@qGLppNmGXp47^KVWm40Pd9Kx}Sw}8$NJBDVT)>jFjR>pGjHh(?z!aXZ&<@o5R6O&;(&OeH6N5!BB?+F@?qWy;p0YrNo(e0|J#Vv>)it2)BdpY-ibvAof<Tnyse^`@4VP0&9~>0(7!oUsjD${Q0goceS%hd`*DJCb?R4HCjJmz_v8=h6Jm%|mdl#Vd%H|?EQeMCFrqm1}D^yiegC8Vv#6|3xs|b+%w<d;xRVxKdLKvEPqllL0(ziHZ!bVN7T9n0QEs_WV6}E95k_4)jY@`K)mh49BAOoE(K$F`YEbl&tT&E%{q;-3QfPwR#P7TVv36pFX(TXfE>ld(_H8hjPh&+jAOWA?~YZf+?nHWKwE=;(;d*y!R^}&<;h{S0VZ11>}spFo38jyuW|Keqi_Ph_VEFLvJ0OMh!PYZ-<aP9_5$SELWf(7c>R@I0WxW-C*;!aE4hP~&5P;J42`Od7tz&1`73|95p@_;4U+{c<5x#_yC8OPeqIh5(kLU#)^TVRs#r0RDmm(18yP+%k2*b=9wRp=O^tAW#k*eY}U3~CMNqvux8<aJO7)d(uQQFps_m|kI_A@Lu^0`i2wk}4z!Koe#5f(HV@Q#^u{mWnzp6oGE*quYV-+H~m<wGR$n7tJ3FDc{TR-{9#l;(fh{yt!r->!7d+mSwuHi6*5;P#<c_gbyI=ZU<S7)fZ;I&YPh=!g=j|7|YiPwqP&-SX$x>z1Rc*yU}x_gu#*y3I%EZLvC*++o=WHE;(??RmFHnn);Ni+jrrw=d{l+s?=@ecrL6$@`we<4(j%u?kW8BPOF3Ri3R8?lb#OW`<c<E7>BpwA?4;v|1Fu_+JvYC4Y#w68g{YPI^SIH(e=czA>G)7+bs#>9HcvYvBtc7z$^xuuCBZY0PCOF0w2_d2AyYUJNqFK>Of{*k!uZI(DyLn{=+tFzlgA{qSl$XQ2Uux`$hV=J2P)1b&QqBl7~F0)3TlZ8|SpYn$%$|X#^pP21YNt4SP066}Kd&$PWcic*MsH@<9|r07rsPrGpZ#5E%m7WQyWqy);1i*`KUGQ>cN#5K<98JTL~V(9HnYrsN%yy4vzJ&!KDlyFUL|0Bo=vVKxwj^;{ErR@^$}3~E4u=|q?H`+8`u#o|`6nBs^GsUhYK!|gb%wY6sO;Z6Ph=GnZPyx1zRRJcSXt?29oqKh>NMD=WhJ}PXANY9L`JvOOHA*UhKoLK625YRmpB&{hwy5$s?CrSrD>bdSqGK6)u5rpjnonqMc1I;04Shs^^G8zjOloYCOv7&LR54y0eC8P(m0P&^Saomw;y`UU52%8Ym%;Q9Bdy=~si<Qp-%hR>$sqOr11>Y~tkc^&m8`e>%P>>ev=+>%|#w7JBwQ&)a^$7^lv3a0V_vMvsNvQHeVVRH=>(>p{rEfgptuXV7Zg+Dm7%OH6_KCU7_0tDb0g`3$7OmIEsd<Ns?fLPyRNw#;+fkQc?U$?7;O#(%I5k=Gaw*tdnR#7_1~uJj2ma2T_C>$Gu3J;489j$20G!s4{YnMdhe9y_YY*J&Oh7qYc(1#i({9hLJ0sBH!XwFS8d5<Ih3D%zk}j}*?Qp0<a#?C6MDJ#LYpy|Or}S;z@zI9DVGVlM^5HIZXb#J+J+JBYYl$yU{=53<zI~z3g1f6_!^ZQ6UT5_vVFlP_xb?RI`+Rr$-NKI*%UABP{y67Qw7J7n7J2K9x^1UWg?;!bE5Fi#<V_!&nHP0_M2Su|D1wa7ya)0HwV%`YOh7M!D~RDCnlM<=E^m1~kBq>Z4|Xu0%d>jOH{mrJmrFI-@-cV8>wSQ4T^(aJa}(2mk><kl&iX*S=1YjpJAB&dz20eO)hB9_9=GB;g^%gn!n`H3?@(U!>REpb@=dRQ?AIWb*FR@<Tu^z{^YUfBgxJw{VD_hZ)LpJmHZN{V6@b2Tp|NZqlVa58sMsduz3SHB|92<mi<4{p70QqYGjpN8%eg-KKSCL%6#'
p=argparse.ArgumentParser()
p.add_argument('--mode',choices=['validate','apply'],default='validate')
args=p.parse_args()
target=pathlib.Path('cosmos-next.html')
if not target.exists():raise SystemExit('ERROR: cosmos-next.html missing. No changes made.')
original=target.read_bytes()
sha=lambda b:hashlib.sha256(b).hexdigest()
if sha(original)==TARGET:
 print('PASS: COSMOS v9.5.3 already installed.');sys.exit(0)
if sha(original)!=SOURCE:raise SystemExit('ERROR: source differs from the exact v9.5.2 baseline; no changes made. Back up and inspect before installing.')
diff=zlib.decompress(base64.b85decode(DIFF)).decode()
with tempfile.TemporaryDirectory() as td:
 f=pathlib.Path(td)/'patch.diff';f.write_text(diff)
 check=subprocess.run(['git','apply','--check',str(f)],capture_output=True,text=True)
 if check.returncode:raise SystemExit('ERROR: cannot apply safe patch: '+check.stderr)
 if args.mode=='validate':
  print('PASS: source checksum and patch validated. No files changed.');sys.exit(0)
 result=subprocess.run(['git','apply',str(f)],capture_output=True,text=True)
 if result.returncode:raise SystemExit('ERROR: apply rejected: '+result.stderr)
 if sha(target.read_bytes())!=TARGET:
  target.write_bytes(original);raise SystemExit('ERROR: unexpected output; original restored.')
 print('APPLIED: unified COSMOS v9.5.3 Metro and menus, frontend only.')
