#!/usr/bin/env python3
"""COSMOS v9.4.8 guarded frontend installer.

No Worker/D1 changes are made here. Input must be the exact v9.4.7
frontend; this script refuses to overwrite unexpected modifications.
"""
import argparse,base64,hashlib,pathlib,subprocess,tempfile,zlib,sys
SOURCE_SHA='c46d85ff20136cd34106487e6b933de80d7650bdd5459c87232a646aff05a170'
TARGET_SHA='079e7abed5db175b691c49aa166eed0cdda1e407ae1ca499bd005f731fa30f0e'
PATCH_B85=(
    'c-q}v-E!MVcE0yhv^5(691;*ES+Y%;(#Wzr<6YTSEO{qeT4lBgG)Y(>zyUzX9GO+Q%2iU8s=dg~R_)!sLN0QbyvaPlK0?kp{euQb>c=y)sbsg-'
    '>^|r|=staZzSG^%hEc!IJZ}&cjIRZ0K1y>h5g!YGSd3!Un<G8&Ja0kE2hC=4QR}b1V%~cD(e|U(W7gD#ufBS~Sdb=p!M=X?_Wkim_j+Y4vOG<A'
    'ywW+lUP<^!taMgRGkz&zw#trU9*BIUwGtI#ltYuVm4coDNj6$JZ=J31@KPkjBom%_y01yBDBEQz51~mkMwaiO!eoVbM48n)%Ito_v=A}&`GyKG'
    'u)N??*)L859(%zg#+N~pBdjx3mrVvD9b|kwoWkR;O_@6LWH8|an&OcupP$cKMiwXIG%N6x??jLZUPNh9kw;F?fg~Fe+dK^dks*x=Y>mB4)1t>?'
    'Ih`KQFNCbNR-Ts?d{&4giICl?EYSGVxQ|1}AFKz{AdZp&kPcLdggb!_M17}9B)aHA62FlJ8s1ej8cFJjE+YLZN(zyAW=7vqo#o}kMrn~|=J{)@'
    'hEIiga;TY9M7b{od5ByK9wj5tkcuohH1I_2vFcSN(_kif6yPxE7b*QH9?`fiBY}N_C=nyB<Qj|1D3_~u`dd;VSWYwdUYcIu$e-'
    'gcJdI&g87G~>$74{zQi+bO8ZjS&VvzQosuEH|o&-pHLBGT$4FjH&gpPHQ7MQE$_!<NyNqwFVVX$6aOk-'
    's7Qr2nQNU7>*5D9n(JUkV_FiGQdFs&-7Y=8@{N~8y4E@}7+onbs#nxvztn(`FnN@G<el2fF)KUXEv$e|cT&>QIorYz-'
    'd4agcD^#V^c8G*(PcsLLwmIFm%nj~F=CoV-c4LLH|f5oDNX#y-%Unr~S0jqHqUGf0iy-mP01XBdm25gXvV3I|J8~~pb=_u_*F*$$(p5e+9LAU5'
    'n$gM>QdNYtewtGo5X3;8(aRdVbHs6Xk?g_c9<wEpfrQ@kbgT_V08flxF#F%HulzJVTGMTrC$@zd9NcUN(lc@_H7ens~UYv-'
    'W+$B+fzoC)c09SCCSJnVu6N!~1X-$RV^HP@33O|Z0h;ljDWCHG6Im9=nOkLA7#D4IDf(M%_rva{elJTUFlQ1=C7e=MqN=E|JA`3-'
    'AZhwR#Rdsw$o+(N*FBEw+z&5WGg((V2Q!3T5RwNzkynd7@<2+U*rb*<;!bw2F^<u#@<yDVV5v8D?OFNHH-'
    'Cn%<9Zoglef6@Q0QDk6p#oYiNFm@^&3L~}vlylHDipjLYKLG(DcRIFszgeg1w$^hN$p!TS`)6~;G5EUT}5%IH11nnq-iFX5g5Gkvxinq+J6+Md'
    '8$30sgSM7@ajRJiv&&bKvHm)iYD7-'
    'sKXxb_aVNMkx2^E6zK;>qe&7;KBg=^R0LWz;jw&pVpmB`CL^ABVU!0c`U8{{Qdmg=QJ=R~dJrN=mo1QUn22mJZLwELKSR$q3Dg8$CE-'
    'N*vT`lP=@mMvEDFhaU!jYF3aafe8VuQG8W#W_l#VCjiua^fd8aE7!SIDj@>ujnJiCx8DhI<f0o$Ze3>JV7-'
    '$pTMf3B=9K&|u?J2X8a*!)9Ya4(>cnNtKRIMY>n|2Xgn2jZ-y0UsV8kf~Zkauz(9^f`(~d5TJ%T13h~UYF(@pf5mN1`i>O5_UUKG-ha|n;aoWR'
    'TIBO8VqJqpd*e{M5GuKC|;&a76B_!0>FK%rhSpu!+3$~W1NzvfFD=OU9rkCR6*Mp5x{gFSFuXuVQiBDX_Xb#(3YqD;tEXN3*vMV5)zaIlrfP^$'
    'TATL;aojJA#4Hjpx8+zG!E%|6x2jPq%eg5u^7InN|3O-'
    'mliUVzf(nw_89yuFNP|^!4pnZQ&O6eAUz$)0fKCb{Hc{BF+(cxj2D%L^fgf|S!?)VH<CDH@p`-'
    '@_Z)G`O0u*M#vGB~J`vevR8LY$|1SHX*fCz`g>i2^o+xDeT$N;8$uS&J*H@;DPjrS8@UhZ`->L*hQ^;u|+9-r4zMse?J(dKf2r{lFN^@SS5-'
    'D*Iq!SAF9-o8}AzwqH<w7DQEn<Lckj4?=oFlBVT!{f%swW0v#R^XxlojcvfD6XoLXevRCaP8uyu=U~wp#2^$30wxNe^BF;zvEJhAq>>KoA-'
    'AD5&rZ5IF`EECgawly(f*QVHg{ELjFM5+OO1Q0UcuEh$V>s)1XCij_TPMU*)en7?*7Uz-YwPfjeC6C;nCCZOJZT9Y@rO!);&qI6K9=!+yL#4k%'
    'rR9R!(7CWGX@)EUEsj&_|QB9#U0jW<+>qG^bEV=`LV}cScQ>h|raCTK(O#}(Ca?)F=r{9z{^kylzpnN1<5ZC}^a~>=P;1KB@PBm4_wtQG3Yn&V'
    'Eaao~fB1?7Zv9HUh;g=D&;too7Bq-'
    '#_B4P^wyJHi0Kmqt%x`=AQ7v_sPr82;*%&8Pf!Yjx@4XVWCv!x&<4iV56EJ|R4i%fGpgD><p05g=z(mz*J_HvR?j72SiyhF%1U9L9-'
    '^blw;U5PwZMW(G_qsl7MF(#=hFL_&5q$^54z(@gPBoOA5bdDvFSwz(qz4u&OB-Y#JTmqXD`c-'
    'QMs72!gUDg{zSpjJ`J=?cxWbaBEXw)K3$LhUCNH!VUe@J_|2RbU7{Tgbhs<KWRoq1PjcF|9zO-LvR2?r>%b`bewJcj%W3^&5%J)tU-RV4_BzLo'
    '?`4WE8*km%oAAQUX+0?lt6M=El>0}6pDLz7?_Ks*|y_y{Yd6Y>K^WfoOJ#3B=8gpw1j2ZwbM&8Ps4olr`6qKncxvH>WK#{-'
    'Bwd8C!(wIri1+Yd}mm5>I3qXjh!h0d!ql}W0UWRBLwRkDn-v<bM+bMm#~o1~Z0D`z2b)OFldTYW(oeYRt^CSM-ypLVZxuGRtg%wF@cD|ak?P51'
    'kd{~~?R-'
    '5vO3IgLh3t5m(0rZ4Pez5Dh4KYVv`cyxGhdibLIsNKT)!TXcbx39bF8#@m?)r{gKj4>1ayi*SK?7SSn8Q4AUO_F@AHjY!aaU9tu?p&+FZ^YD;k'
    '3|9*@j%u=>|v)5ky20v>9U4nILxv%L(Y96!W=t{%f1R&oTe8d=_HdlhUqr{m*$ZP%tFeNY9=dIJ6NTB_)AP&ud~PjwTW)t-'
    '90HVlX3ICJ;!PIU|+c9?XI1zKHFV!&esO5pu6i{JF8B|S>>a#({i3+F)pCAi=_dUR<QK_B!%*dvjXKWHlOY|v$Np5(J0?q;8415qq}<zsNfoc`'
    'Xoyj3F!pD26$P2Ac|L@mG0@=-'
    'yFXA?l*_OYkd0TI6E^~fMBS5Ai<gp2A8gzw~BNe1;CtseR2%>w^1>49qD>HPGe6!1B4^o$Bho!+F5>%uXSbjPoL;_N1q@(-'
    'c%<DRG<?C_1dh<uXt3jzJQ^*`^T@EV_pnf*S_zkV^WvaP)4rKH9&x2nngd58g-oKkgtNvbDBj9TDz*b-%G>k-n9c@rNCW-'
    ')9F}%Tsin?mGi890OfOLu)2*|E8vh4cAO;jaC1aBGm^9#9HujBe3_5E+=fpwbW!{+Fp#aIzWXrq(~HJ67&lcjlw2{%yIpVqj~c}=ORpFyn(Len'
    '1v_|q^7`!wqiw!#A>6<`q8yUi9OD`*h6ww>WdfGY0fdC(6skUZ0g9DQ>G9=L|B=5@Vc_DLv&}|}C22v8axvx@=!sbzM+4g6mCb#pfhK(0XmK_C'
    'C<)>T;1}0fgEVE$Y>cdFn|5HuZ*D2A6Le?U^b<6`a%xYQ<_+m%2v4s{LF7JrKMrwTX%b6uSe$%V?YoFLvLx%sb!7I;aq)eD#ZRC9@XD-'
    ')%8{6~A`!B0PEU{7udcNWXZ{}~vl;%QYz=v7W7ukMwKg}<8nCqWsA3Mepq;s1EV|04z<~TBDq?{q+-'
    'N$W@79w5VO*L`>EVv`#vC*KLWF(}xWFyIo)_El>T3B)zeta8Q|f@{0yN#MWnoNR>iZ1zrmwIkLx1{?7S|;V-'
    'Xi4GCHD&U(9|;{m)NCP;hRu!MqSRyJC#kzcjT%qg%#88?3~)6!I2+yLGd1Hrs(CND!coD=my2GA?0ClzYx>znd;n<L#DBz6Omod{STlOuJcKmh'
    '?+nKIbu4|<B|%k24)6DlLwhvO&~m}R$yN6^3_$>eyjqPnW28o>go$@l%!W~!_!2c+@uJfZM47KZhyJnZnqou3}Fb%dD{(_3=oD#k3-'
    'NNFt24Zl>$+rv8!Y`$G7_SZYI8;fCYhzU*a70sA1P>f|p7|@&4Vb1His%VpOZqAcw_#u=s@R6Jj7tSq<c2w`+7_@%$dr0@!k(|16kh7XuK!p`|'
    '3=DOY2*Gt&c+!9e_i!yt5tSc*JRNBASaN)Y20jH^Y`gl8RRlJHB&@X@FpYq+?h6~|MGUe^oOxVmCHIlf>LgD=>b(ek28D-'
    '9n~aXKegi$k$bYKFG&CFZ_^mZFLC_B(I)%9hEtNwP+E-VIi*-'
    '++ca&$DjiYisNnJUn=JK@la50d$y|cob=j#xe|cjOUC~eg;i&ZytPJ+~dK8e>bm3VxR^;O$K-JY_|x2S-wMK?~2#bx@?2-'
    'x?eFmT<3sprJ`=s;0_+8%JJ?Fg__^RpLh%0$-'
    '+5QZFYVZT?+9t#j)ZSZjfqY0i&fR4^i@+7|0Zw@Q`KYere`Qykpn6B^{pbJR&`{<}#P}6L>G3EzRc^ueCrc>Q0MQot9CN6HzSmTgz-'
    '!Ht2WZ!QT8dI+8>Qq)}_nLJs{!aHa**>h5P5pZZZwzixj|?I-'
    'N@eJvT{q+s1Oyp{6QPQN9e0}qf;4Di(b*xk)}U%by^_oF|_Vpxq4rzqimq)az&G!&F;x3=1inPqy*r(OeRGEyu8K`n5Z_mPibDfiZDl2DjHiDP'
    'wD)@4=s!acPUpd)CN0gR^X4V7wFAav9_K7E2p4e9l7grBk*@$0(Px5~MgRg_h;l#Tl=l?vK<nia0gTfK(aXXyEKzK}!n?|4DjUy56xhl8xxRSo'
    '%kLrVo7x8<zobW4s}Dp+fhi}0n2Y@O$68VjDFaKY5&x^=r$lfrDMeVEyD(|auqT%`-RMLD&Nu-_#TDGRB-'
    '1@;?y@8Sfv(xU`Y1(x$mbwQ`FvS#1WeapxS5-|*pWSvc64klSDyZ`u4e{t%W#=@5iAzA1xt>_0KvsK@zBJvvtP<yW(jm-{~?pY%n5iNxb=9LG-'
    'G|lau1(<*}ZaEaaOp&l;C|3mZqvGEe!T{#HjEJl}g$z}Y7cmUPicQmz6P4V-=?Qy=Wtbah>1BjC%nEfKVAPi#AR9gfFh-YOuAp5x;D>zxN;TK2'
    'cWUb^Al2B5qvQhC&YHhH#)tii|Ikd#jP{&2sh)9_A<f_H7R(94uTFu%bDpFS!!s5{#dM7VEHrjH_y%iq%t(awvvkDNH5v7GYw;e+w=EhzvaF7l'
    'XGIjmz+JJ6@jeMSCd9<H?#N-wah3`NgRd+`^QWjLN)yjDGrV=ll_u5AYEj~{x_Z-'
    ';4~8PRsOhI|?xpupYI!reH@LidQ>dn<B`e9v2xK|GszQ<Iajc|7)`EkeX$On&J)4R`u7}nfvv*cqkj{-'
    'f7by{O4WoWv5V_)B%grXoS?=u*c!n`e?F~%;@#w7~wH@|ov-PM=+hN;Vt<7z@9cK8zYr+0itbhQ4r$Zux-fG*mBw1MqKtv|uu6gD|qJWSursH_'
    'm>A={=g6#sDr7Q1GA8nZXUziPPyNMguz$Q$C37+2hbah)C#&nkFI(WEGd!IWZ_Jf$``5W9rcNXx(7P%<)3kb`-Ng-'
    'T^XA$>6@FI4kY`~WpnE}gk>|i!{9^t}hc4jy<%v2|Zm5fG7j-'
    'CUv){sw~9F{mj$w~K?W+7e^z&&B!OI3DzCBy}8o#Kgj1{&a(@pmZuEtei3^dd_=c$KHxmNHX>)m2sS@nZrdu@gv=fdrWpOhrG3v5TzO4?l1;Mk'
    '8C^M@36Qr-jo-'
    '=Jo9c3tyAXbQeJTmfF_75qjW0LD!g_#Wom%OG=J#jk;>Mdv#e1H=M?vU%({Qd4ojDH6C3&NW_gA*W%fjYX<pJ_swL~1Cd8LMA67}z@wE@SStV_'
    'dz4|av+}`9Fsk1Po<Y*DU|;#{HH>QLHk#`Vf6PNV+jTcuPTN_~mIm0EYpC}LJg3pA%uS=FSA>Jj6!vWAR>EENx{nK>tHz`2?FN8J!${`RzW@N1'
    'IaN6kym~Mhcb#Wpbjiq&yDOy;<I=C}J{xZC{`jZAFmm_*^&jBer4qq_9gU%!JxAXJ23M<ZAUKVtz3h9A>@E)vD+<w}4gP0q@G7TClV3QbO&XHN'
    '<=qb$8Vn?vZ!{38bTBKx&83L)*FXR9U&~hm310cvKmW_Wl`%pN02!7;0Ebn8CoZOA(Or?16*|%IbeP#Csp#6XHQ8wQhMoWgAdU<@jE%eRWQ79K'
    'T{?sBPCN`HyZf=)3i<J$|K0Sw!@xxt6}#n`j_Wj+LX@V{D95x0%c1^NZ*irI*>j$a=a&FyhiTIa%OGv)uE@5y9%>0Bfn+}3bvnecVpcj`U80+y'
    '*@b3KWnf+HKjLGwzJ=i!Y+ahRTy>gNN6Bt(Hjlj|^-$I;yURhNF*b&BM}UG~S0Gxcra3-)OWUiaV<sqOQ7;j}g8*-'
    '6t7~);%HV+?bd<iAadRGnuV^9ALA797BYcu*qq%%KMkHQ8O+j+UX6$sd7z!9G-'
    'ZIW9O3Keb5N**7Kj{I;s1C@2<+D!Rx=LKH5S1QM1!hj@G!s3P^bRk93NZn2D*PIb%B5MLvg}uJqRNp-'
    '5tNwo=Rz|~lb(=1+!5SJw3&oUP!1m>$T=8Bu|_&_Pkx`}L-'
    '6Ne70zJxZ9cj{rrOzd%3K~bPlavf?P`r0r8wOjDWoRWE>r+^6yFK<$foMx08<gFLvBpJOEHgnd^gAgoJEW&5#~>de>pZ-AKjB=CSR~zoXD<zQr'
    'oC+P*nH*AnjSO$=8_2Va?ldnA+359}u(8gS$4U(5k-KnA=1|4AWg=T6eaePG!TB^tgN1_-'
    'T)5G6G~VRl~8j(e|7pbY_Ljxe$++X;=jL&PUuRKp)`7G6BXb*OmSL1^^7jqwHFB%BcJ3wQ_q*bSFw}ZBlvhChzTt$Z`S-'
    'AW>*kC`k=1`5dq$0noF21j2%FM&fU}G+5~!fBe%Q*$KZCp`!tlY-{2&?VH{WI^6-'
    '=9Nh!fd@io|Y^+m5Bs6opgLMboV67m9QgKyB63FNN_(4g3F5*7%zMn**Sc-'
    '+pQ?7C+&Fobepg<N=SNYs`G=^&2wERz0sDGvau0~<fPywfxPUNOQT(&ZhT_a}o?z;hBR>sNh3T;afRI>J^R(2&>Ix1ZH|Ew*&*)4`3{9Pb(PzV'
    'OnfHB}3s-j`EjuMCw-<-'
    'Za(lk0~gLqSqd1pqe&mqG~lK`CL1>HSFy*vbZnwdCoBM)s(i}+{@tMT)0;%Cdz=E?JE63|JZ?5{nV6k7L=>~>^xAJiVzEbJE9MC@pe>Y<hOcO8'
    '|(fUcTdW5#ZXu8r%(2c_VKm!Fi+G+RUl)uYhL(c0|x*UyD<0vq}+rU<L6z?SX9soN{d#A>|PqGf-feF|=1oB$jZiH#}lzxHz3)nVWbSC|$&Dp$'
    'bV$0;|i=htqz=xy1}Xqn9Y9`+e4z7TCOChy?Uf9CGrp{h3QV{mDhvs(=6vzJO;b*$|E-rUD*{XW^2*Mhg(<`0W73`CZLS`x-'
    '_pq{)KY@o*mL67@k4f{X^aK{Gva23Dqxod*q;$-gNNAA0-'
    'tEl4?KmkT66}6W~i6DlYa`yoLW&d4|_GXC7C4+aMY1>ByRob4oIqsTG2&c@Nm%l(m1RIv$1Qn!K&f^6W#F}?}p*w$cviG@z=-'
    '?{f1UAYuu=1jfLK*e(qsP&iHA=sdfuT-U?v+P5-'
    'b0oSixfT+BN#3it6?H3hxo<l5zHOG%XXa$F%8qJ#A&6pLAo=um=dY0F6IayFN1*z9MU2?4fRUA6;r;0hv6+RP?oyA`J}bJNv68B-'
    'P&l|wp#NhfM7=CLGnp&6csWcGaQxz2ndGpr7uLELt5iD)ZLm(9(P?jzVe|s5k91ABfLZ@w@9teDt@0g*9I+z>08_As-'
    'X)ctZV;x_WSYm(d=CQz&~$h%x^i~`Sp71@zdF_)+Rn?CfK~uFc3l7L^Ytl$8bnTuq{xKfjUf6r?JeX<CKJf1T*}~3?99IchvBm9d!()La@#RNf'
    'e93bw<`N8zAtIr5f;9G(O0HP*-(qvQP(p6;i#2nbURFS}<$ryE!0>*-jNL;hl<5fBCTdnjNM!xMzX;TCMAmD28d+agO&-'
    '5593)Xa${LpS*qJ=ahIy{i$1i`D5ip=4-6-TOj+XCYB!%%^I^3nAB!vee<P1%E7sm4ff3I=ro{w=d$Ly0X3g3c<-Hqd1-'
    '@obS8c?b*(PTBrvS4HqfnGfEq8OHpU@En4XYp1`1f$AUbZ{F?eB-E*-'
    '~$gSrRu5PqrF@4&0*FCK|PE55Dp&A*Al(?)Vt>zi8Z^&Ib|#O528yJ>LsZZR28W7e=yqpe7LwkBD7Ee*)g&<D+Z7(^G4@fMC;SC~mZ%0}vI9<{'
    'TnS^5luS1{zsK(H&GYYiv|qYf7(kNX<*qB$8>_nw!zk$?lmnbF7S3EjDpYpU*&`pjq}X1+M_7wcvBLf&>Q2Y0Len=#+r2Q2JT_XCyp+k0s!0BB'
    '_G34VsJ_}S7JWlHo1zx*JL)2!=!vHp1b$!5=4XlG`7P2E+x51hvH54S#jOCN`66o`|>#x24ny_JWUZ;v~HPC3!ir{?msJe?G-'
    '^0}?2?Y17r0$*E|4i7fqzYC?a#1U(yzRd?y9)^1^G)VmJ%I^ah%UyF*xtc>&c0_dAwEgsnOq(8WlwVUy|7ThKm`^b^wCrKQI-'
    'VgcP;TY?wwSEDYsyXC=Yw{qW~j5B2Y&;=p`=g(hDCGi%4O5lokbH-ZFF_V{$8VuS=PNwH1E%_dq~esE?}dC=KqDkf3~w)HtYLAqn%!nEU`KKS8'
    'k#%usms2kK1ZD;_>FXHY>bHrpKc>+WQ=Gv+=r2!c@jse!(KIMJX}_M=1dNt8%>)Xw$l?gT0#FrJvUCERTV;5A5wl?OxAnYh0tKOO-'
    'a26h?}na;v#Qt7y?ooiYCZkbwI5p;oVStXxPf$@1XsCyG+vd6c5jHy-VcO5|z|ZuOOO{5?hiy7neSUeJlG-'
    'U}EAeW3h&`YLpt4=G+)o}OSUfJpfeQ2+AQ^w_c4m;MPk%w3%G@dlztN9s(StjoJ%fFoME?`uGaOZtC7eXxO}EqHxnv)$SP3tr#Y+G=fWN)x7!f'
    'MyMv`m?n>$f9wv`=I%t`HX@-'
    'i$d#s=zS9PBN5`CihM)IFAth)U$VCef^QfAem#$%sFxN)Hc6sO{6lNCI|nUw#el9=wh+H2&@}CVo6Y56t~uTD*_Ue%nqTnoSV@3Rd&`;a`qi5j'
    'Eoe-FHlExYr6IUq+A}mXfXLkyVzP41zR={?%eYe3M7JtBPumZp5&b<TFuZ;&K6a8c5f%*)SuyO4qQqTa-'
    ')fIPw!laNcfH;IJLa(sAT%0QYh*m)A3fPi_OKoU4jM#BXJcdhk^YVxTVJm>7(<eYe}-dyqe4cuc#1yAz*~f!Y|!KG#-r`l#-'
    'pdLjjfHAzqMtLq9^CJ4sXfR81gFF0aQf)uhxP1QztJ21DfQW^{vVPdg(_mAM!B0s>=t56=vyJ>2m$?gXZk!^{!tr`MFlS&evM=joa27R@)njXf'
    'P}~?YY(Sz!dNg32fC?=+5(0H*|jfi7Lj|YW3}*FBqI(z0UAC!>O^j9`JDo6?%uq(ID~UCt&n97|Nl*NNUztXT#`j!!@9qam=Tk9>k@K9ZFO>Uu'
    '-_z;@ja)ACQoDC0FQiyDjT^^n)P7(F;|i<Id*z<IQugk3d}v_=)0J!j+UzPYnMKs<lK|^+00qtPmc|cQS$$0&l|e!rg3vPJ&~>+dBPh&gG!spV'
    'T~!c0vpN8Tv1ah^a<D2IIy*^$k$+HpRYurn~%?k>D<`$dHty?x&(3(1j|029(bh3wiU>7d+msh*%5FyUIZPJegh%AyK=<wIItSPJYh8+y46L=3'
    ';+6=i~v>Z>&FQZES2qr}>~@{QLU6`?^8;bdTj)g)a~TYnxE@m}<&CAFXda-hNuM$D3K>{S;&DD6*Xole~aT)>F4QWE$@EL;(OQsrVN8w|Q+7ux'
    '<Y-RMoh)+mAP%Y}n(1`O^Z))x&>oAEvqnajmD0g20#5*w!T7UhIMt+VlwQS)t;y>_*-'
    'gmEh77$pEkJs<+`SV?AOWyCjC$gpsi(6Un8EU*>wif_r#Xvrz49KLb<vivDt>TiVd}HsT*L$a_ILX#NX<I>zM4Y>>7NYSFk6gl#SXVe4}sY_@2'
    'wcZw#TG3PtPlf^*;LPTZZ*m73Y>wy%(D_-tCy|sB*E^`x2Qp*#{tcrJM<aZ!P!MtP_vlZOYq5}TEvFtwhAC-T7GX'
)
parser=argparse.ArgumentParser()
parser.add_argument('--mode',choices=['validate','apply'],default='validate')
args=parser.parse_args()
path=pathlib.Path('cosmos-next.html')
if not path.is_file():raise SystemExit('ERROR: cosmos-next.html missing at repository root.')
original=path.read_bytes()
current=hashlib.sha256(original).hexdigest()
if current==TARGET_SHA:
    print('COSMOS v9.4.8 already installed; no changes required.');sys.exit(0)
if current!=SOURCE_SHA:
    raise SystemExit('ERROR: unexpected frontend source ('+current+'). Expected v9.4.7; nothing changed. Back up the current file and use the complete HTML only after reviewing differences.')
patch=zlib.decompress(base64.b85decode(PATCH_B85)).decode()
with tempfile.TemporaryDirectory() as d:
    tmp=pathlib.Path(d)/'cosmos.patch'
    tmp.write_text(patch)
    check=subprocess.run(['git','apply','--check',str(tmp)],capture_output=True,text=True)
    if check.returncode:
        raise SystemExit('ERROR: patch verification failed; no files changed. '+check.stderr.strip())
    print('Verified exact v9.4.7 source and v9.4.8 patch.')
    if args.mode=='validate':
        print('Validation succeeded; no files modified.');sys.exit(0)
    applied=subprocess.run(['git','apply',str(tmp)],capture_output=True,text=True)
    if applied.returncode:
        raise SystemExit('ERROR: git apply failed. '+applied.stderr.strip())
    newhash=hashlib.sha256(path.read_bytes()).hexdigest()
    if newhash!=TARGET_SHA:
        path.write_bytes(original)
        raise SystemExit('ERROR: updated file fingerprint unexpected; original restored.')
    print('Applied COSMOS v9.4.8 frontend with verified SHA-256 '+newhash)
