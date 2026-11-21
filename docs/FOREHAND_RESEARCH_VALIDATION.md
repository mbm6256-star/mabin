# TENNIS LAB 포핸드 연구 검증 및 MVP 지표 선정

이 문서는 [포핸드 생체역학 평가 기준 설계](포핸드-생체역학-평가기준.md)의 후속 검토다. 6편 모두 서지와 공식 출처에서 존재를 확인했다. 논문의 연구 장비와 현재 MVP의 단일 영상 추정값은 측정 정의와 정확도를 각각 확인해야 비교할 수 있다.

## 1. 논문별 확인 결과

| 논문·저자 | 공식 출처와 확인 범위 | 연구 대상·선수 수준 | 장비와 측정 지표 | 주요 결과 | TENNIS LAB 적용 범위 |
| --- | --- | --- | --- | --- | --- |
| **Key Factors and Timing Patterns in the Tennis Forehand of Different Skill Levels** (2010). Johannes Landlinger, Stefan Lindinger, Thomas Stöggl, Herbert Wagner, Erich Müller | [JSSM 원문](https://jssm.org/volume09/iss4/cap/jssm-09-643.pdf) 확인. 공식 URL 사용. | 남성 ATP 프로 6명, 고숙련 주니어 7명. 크로스코트·다운더라인. 두 집단의 연령도 달랐다. | 8대 카메라 Vicon, 400Hz. 골반·몸통 방향각과 분리각, 분절·라켓 속도, 임팩트 기준 피크 시각. | 프로 집단의 골반·몸통 각속도 피크가 평균적으로 임팩트에 더 가까웠다. 두 집단의 평균 차이는 각각 약 18ms였다. 타구 방향에 따른 각도 차이도 보고됐다. | 골반·몸통 회전과 타구 방향을 기록할 근거. 현재 12Hz에서 정밀 피크 순서나 개인의 회전 타이밍 적절성을 평가할 수 없다. |
| **Kinematic and Muscle Activation Differences Between High-Performance and Intermediate Tennis Players During the Forehand Drive** (2026). Bruno Pedro, Silvia Cabral, Filipa João, Andy Man Kit Lei, António P. Veloso | [Sensors 원문·DOI 10.3390/s26072244](https://www.mdpi.com/1424-8220/26/7/2244) 확인. | 남성 고숙련 9명과 중급 9명. 볼 머신으로 공급한 공을 크로스코트로 타구했다. 타구 손은 초록과 방법의 기재가 달라 근거로 사용하지 않았다. | 240Hz Xsens 전신 IMU 시스템, 동기화된 표면 EMG와 영상. 관절 각도·각속도, 분절·라켓 선속도, 근활성. | 고숙련군의 스윙 후반 라켓과 어깨·팔꿈치·손목 선속도가 더 높았다. 각도 패턴은 대체로 유사했다. 초반 무릎 굽힘 차이의 보고값 p=0.002는 논문이 명시한 운동학 보정 기준 α=0.0017을 충족하지 않는다. | 무릎·팔꿈치 각도의 시간 변화를 관찰할 근거. 무릎을 더 굽혀야 한다는 규칙이나 팔꿈치 목표 각도는 도출할 수 없다. |
| **Kinetics of the Upper Extremity in the Open and Square Stance Tennis Forehand** (2003). R. E. Bahamonde, D. Knudson | [PubMed 공식 초록·DOI 10.1016/S1440-2440(03)80012-9](https://pubmed.ncbi.nlm.nih.gov/12801214/?dopt=Abstract) 확인. 초록 범위로 제한했다. | 오른손 지도 프로 7명과 중급 선수 8명. 오픈·스퀘어 스탠스 비교. | 고속 카메라 2대, 100Hz, DLT 3D 복원. 상지·라켓 강체 모델로 손목·팔꿈치·어깨 토크 산출. 임팩트 라켓 합성 속도. | 두 수준 모두 스퀘어에서 관찰된 임팩트 라켓 속도가 높았다. 일부 토크에서 차이가 있었으나 오픈 스탠스의 상지 부하가 전반적으로 더 크다는 가설은 지지되지 않았다. | 스탠스를 비교 조건으로 기록한다. 스탠스 우열이나 부하를 관절 좌표만으로 판정할 수 없다. |
| **The Influence of Grip Position on Upper Limb Contributions to Racket Head Velocity in a Tennis Forehand** (1997). Bruce Elliott, Kotaro Takahashi, Guillermo Noffal | [UWA 공식 서지·초록](https://research-repository.uwa.edu.au/en/publications/the-influence-of-grip-position-on-upper-limb-contributions-to-rac/)과 [DOI 10.1123/jab.13.2.182](https://doi.org/10.1123/jab.13.2.182) 서지 확인. 출판사 직접 열람은 403이었으며 장비 세부는 [저자 공개 원문 사본](https://www.researchgate.net/profile/Bruce-Elliott-2/publication/287167307_The_Influence_of_Grip_Position_on_Upper_Limb_Contributions_to_Racket_Head_Velocity_in_a_Tennis_Forehand/links/577f4d3d08ae01f736e186ba/The-Influence-of-Grip-Position-on-Upper-Limb-Contributions-to-Racket-Head-Velocity-in-a-Tennis-Forehand.pdf)의 Methods에서 확인했다. | 오른손 고숙련 남성 12명. 이스턴·웨스턴 그립 각 6명. | 동기화된 고속 카메라 3대(명목 200Hz), 상지·라켓 16개 표지점 및 DLT 복원. 분절 운동의 임팩트 라켓 헤드 속도 기여. | 두 그립에서 상완의 수평 굽힘·외전과 내회전, 어깨 선속도가 주요 기여였다. 손 분절 기여는 그립에 따라 달랐다. | 그립을 비교 조건으로 기록한다. 팔꿈치 끼인각으로 상완 내회전 또는 라켓 속도 기여를 대신할 수 없다. |
| **Influence of Tennis Racquet Kinematics on Ball Topspin Angular Velocity and Accuracy during the Forehand Groundstroke** (2017). Sunku Kwon, Robin Pfister, Ronald L. Hager, Iain Hunter, Matthew K. Seeley | [JSSM 원문](https://jssm.org/volume16/iss4/cap/jssm-16-505.pdf) 확인. 공식 URL 사용. | NCAA Division I 남성 13명. 실험실 계측과 별도 코트 정확도 시험. | 라켓 마커를 추적한 Vicon 카메라 8대·480Hz, 공 스핀용 별도 240Hz 영상. 라켓면 각도, 임팩트 전 수평·수직 속도, 이동 방향, 타격 구간 길이, 공 스핀과 정확도. | 라켓면 각도와 임팩트 전 수직 속도는 탑스핀과 관련이 있었다. 조사한 라켓 지표와 정확도 사이의 유의한 상관은 확인되지 않았다. | 라켓 속도를 성분별로 정의할 근거. 손목 속도를 대용으로 쓰거나 빠른 스윙을 좋은 자세로 평가할 근거는 없다. |
| **Influence of Ball Impact Location on Racquet Kinematics, Forearm Muscle Activation and Shot Accuracy during the Forehand Groundstrokes in Tennis** (2020). Masahiro Ikenaga, Nobue Okuma, Hiroki Nishiyama, Shinichiro Chiba, Katsutoshi Nishino, Go Omori, Hiroyuki Nunome | [Proceedings 원문·DOI 10.3390/proceedings2020049089](https://www.mdpi.com/2504-3900/49/1/89) 확인. 학술대회 논문. | 중급 남성 8명. 볼 머신으로 공급한 공을 직선 포핸드로 타구했다. | 16대 카메라·2,000Hz 3D 캡처, 동기화된 표면 EMG, TrackMan. 스트링면 기준 공 위치, 라켓면과 속도, 전완 근활성, 공 발사와 비행. | 위쪽 중심 이탈 타구에서 중앙 조건보다 초기 팔로스루의 요측수근신근 활성 증가가 보고됐다. 네트 통과 위치의 유의한 차이는 확인되지 않았다. | 스트링면 타점의 정의와 추가 계측 설계에 적용한다. 신체 기준 타점의 적절성이나 부상 위험 판정에는 근거가 부족하다. |

### 검증 범위와 판정 한계

- **좋은 자세·나쁜 자세 판단 가능 여부는 여섯 편 모두 ‘불가’**다. 표본의 집단 차이, 모델로 산출한 기여도, 타구 결과와의 상관은 개인 자세의 판정 기준을 제공하지 않는다. 숙련도, 연령, 타구 방향, 스탠스, 그립과 과제가 달라지면 적용 범위도 달라진다.
- Pedro 외 논문은 초록에서 참가자 18명을 모두 오른손잡이로 기술한다. 방법은 중급군 9명 중 1명이 왼손잡이라고 명시한다. 손잡이 구성은 본문과 초록이 일치하지 않아 제품 규칙에 사용하지 않는다. 초기 무릎 굽힘의 유의성도 기재된 보정 기준과 결과값이 일치하지 않아 **확정 근거에서 제외**한다. [Sensors 원문, 2.1·2.5·3절](https://www.mdpi.com/1424-8220/26/7/2244)
- Bahamonde·Knudson 연구의 상세 보정 절차와 지표별 오차는 이번 공식 초록 확인 범위 밖이다. 전체 6편에서 현재 TENNIS LAB 설정의 기준 장비 대비 오차를 확인할 수 없었으므로 **미산정**으로 남긴다.

## 2. 단일 카메라와 추가 계측의 경계

현재 MVP는 12Hz로 단일 영상에서 이미지 좌표와 골반 중심 상대 3D 좌표를 추정한다. 약 83ms는 샘플 간격이다. 측정 오차는 별도로 검증한다. 영상 평면 밖 움직임, 가림과 흐림, 카메라 기울기, 깊이 추정 오차가 각도에 영향을 준다. 가시성 0.5는 현재 오버레이 표시 기준이다. [MediaPipe 출력 좌표 정의](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker?tab=Web)

| 지표 | 현재 단일 카메라 | 추가 계측·검증 |
| --- | --- | --- |
| 무릎·팔꿈치 각도 | 보이는 관절로 2D 투영각 및 골반 상대 3D 끼인각 추정 | 해부학적 각도 타당성은 동기화된 기준 3D와 비교 |
| 골반·몸통 회전 | 어깨선·골반선의 방향 변화 추정 | 코트 기준 회전과 신뢰할 수 있는 분리각은 수평면·카메라 보정 및 기준 3D로 검증 |
| 회전 타이밍 | 영상 시각에 맞춘 큰 변화의 관찰 | 정밀 피크 및 임팩트 기준 시차는 높은 시간 해상도의 기준 모션 캡처와 독립적으로 확인한 접촉 시각 필요 |
| 운동 연쇄 | 신체 움직임이 나타나는 구간 관찰 | 라켓까지의 순서는 라켓 추적 필요. 관절 토크·에너지 전달은 외력 계측과 분절 모델을 포함한 역동역학 필요 |
| 스윙 속도 | 라켓 헤드 속도 산출 불가 | 보정된 고속 라켓 추적 또는 기준 장비로 검증된 라켓 센서. 임팩트 기준 속도는 접촉 시각 추가 |
| 임팩트 위치 | 신체 기준 위치와 스트링면 타점 모두 산출 불가 | 동기화·보정된 고속 라켓·공 추적. 신체 기준 타점에는 동일 시각의 신체 좌표 추가 |

## 3. MVP 우선 지표 세 가지

좌표로 직접 계산할 수 있고 임팩트 검출을 요구하지 않는 시계열을 우선한다. 전방 스윙 구간이 필요하면 사람이 선택하고, 선택 구간을 결과에 표시한다.

| 우선 지표 | 측정 방법과 출력 | 연구 근거 | 오차 및 평가 한계 |
| --- | --- | --- | --- |
| **1. 좌우 무릎 끼인각 변화** | 엉덩관절–무릎–발목의 가운데 관절을 꼭짓점으로 두 벡터의 끼인각을 계산한다. 직선은 180°. 기본값은 영상 가로·세로 픽셀 스케일을 반영한 2D 투영각 그래프다. | Pedro 외가 스윙 중 무릎 관절 운동학을 분석했다. 보정 기준을 통과하지 않은 초기 굽힘 차이는 판단에 사용하지 않는다. | 반대쪽 다리 가림과 영상 평면 밖 움직임이 주요 오차다. 누락 시 그래프를 끊고, 관찰 범위와 가시 구간을 표시한다. ‘더 굽힐수록 좋다’는 판단은 유보한다. |
| **2. 타구측 팔꿈치 끼인각 변화** | 타구 손을 입력받고 어깨–팔꿈치–손목의 끼인각을 같은 2D 정의로 계산한다. 영상 시간축에서 보이는 구간에 값과 시점을 표시한다. | Pedro 외는 팔꿈치 등의 각도·속도 파형을 분석했다. Elliott 외는 그립에 따른 손 분절 기여의 차이를 보여주므로 비교 시 그립을 기록한다. | 팔과 몸통의 겹침 및 전완의 투영 단축에 민감하다. 끼인각으로 상완 내회전, 전완 회전, 라켓 움직임의 적절성을 판단할 수 없다. |
| **3. 골반선·어깨선 방향 변화** | 골반 상대 3D 좌표에서 좌우 엉덩관절과 좌우 어깨를 각각 연결한다. 초기에는 영상과 함께 방향 변화를 표시한다. 수평면을 보정하고 양쪽 끝점이 충분히 보일 때만 수평면 투영 방향각을 계산한다. | Landlinger 외는 골반과 몸통 회전 및 분리각이 타구 방향에 따라 달라질 수 있음을 보고했다. | 깊이 추정, 가림, 수평면 보정과 축 정의에 민감하다. 선수의 해부학적 몸통 회전이나 회전 효율로 해석하려면 별도 검증이 필요하다. |

### 리포트 적용 조건

지표마다 좌표계, 표시 구간, 타구측, 결측 사유와 **MVP 오차 미산정**을 표시한다. 촬영 방향·스탠스·그립·타구 과제가 같은 반복 영상에서 기술적 경향을 확인한다. 입력이나 품질이 부족하면 **판정 불가**, 값은 계산되지만 타당성 검증이 완료되지 않았으면 **추가 검증 필요**로 표시한다.

전문가 검증 전에는 임의의 정상 각도, 정상·비정상이나 좋음·나쁨 분류, 자세 점수, 프로 선수와의 일치율 및 이를 대신하는 색상·등급을 생성하지 않는다. 다음 검증에서는 동기화된 기준 3D로 조건별 각도 편향·MAE·일치한계와 표시 가능한 구간의 비율을 함께 확인한다. 스포츠 생체역학 전문가와 테니스 코치가 지표별 적용 조건과 해석 규칙을 검토한 뒤 공개 범위를 결정한다.
