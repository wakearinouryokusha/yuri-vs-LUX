/**
 * train.js — 優李 vs LUX AI 遺伝的学習 (Node.js / GitHub Actions 用)
 * ブラウザAPIを一切使わずに学習し、最良個体を ai_model.json に書き出す。
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ════════════════════════════════════════════════════
// 設定
// ════════════════════════════════════════════════════
const CONFIG = {
  POP_SIZE     : 30,     // 個体数
  ELITE        : 3,      // エリート保存数
  MUT_RATE     : 0.12,   // 突然変異率
  GENERATIONS  : 500,    // 1回の実行で回す世代数
  MAX_FRAMES   : 18000,  // 1個体の最大生存フレーム（打ち切り）
  MODEL_PATH   : path.join(__dirname, 'ai_model.json'),
  HISTORY_PATH : path.join(__dirname, 'train_history.json'),
};

// ════════════════════════════════════════════════════
// ゲーム定数（ブラウザ版と完全同一）
// ════════════════════════════════════════════════════
const W=640,H=240,GY=H-40,NW=24,NH=36;
const J_SMALL=-7.0,J_BIG=-12.5,J_BOOST=(J_BIG-J_SMALL)/12,J_DBL=-9.5;
const MAX_JUMPS=2,COYOTE=6,GRAV_UP=0.62,GRAV_DOWN=1.15;
const SPD_BASE=4,SPD_RANGE=6,SPD_HALF=600;
const GAP_MIN=200,GAP_RANGE=240,AIR_GAP_MIN=800,AIR_GAP_RANGE=640;
const AIR_Y_MIN=55,AIR_Y_MAX=110;
const PROJ_SPD=15,PROJ_COOLDOWN=45,MAX_PROJ=3,PROJ_RADIUS=27;

function calcSpeed(f){return SPD_BASE+SPD_RANGE*(1-Math.pow(0.5,f/SPD_HALF));}
function randGap(min,range){return min+Math.random()*range;}

// ════════════════════════════════════════════════════
// GameInstance（ブラウザ描画なし）
// ════════════════════════════════════════════════════
class GameInstance {
  constructor(){this.reset();}
  reset(){
    this.nj={x:80,y:GY-NH,vy:0,onGround:true,jumpsLeft:MAX_JUMPS,coyote:0,hp:3,iframes:0};
    this.obstacles=[];this.projs=[];
    this.frame=0;this.speed=SPD_BASE;this.projCooldown=0;
    this.nextObsPx=randGap(GAP_MIN,GAP_RANGE);this.nextAerialPx=randGap(AIR_GAP_MIN,AIR_GAP_RANGE);
    this.holding=false;this.holdFrames=0;
    this.alive=true;this.empoweredShot=false;this.shotCounter=0;
  }
  spawnGround(){
    const t=['low','low','low','tall','tall','double'][Math.floor(Math.random()*6)];
    if(t==='low')  this.obstacles.push({x:W+20,y:GY-26,w:18,h:26,type:'stone'});
    if(t==='tall') this.obstacles.push({x:W+20,y:GY-50,w:16,h:50,type:'spire'});
    if(t==='double'){
      this.obstacles.push({x:W+20,y:GY-26,w:15,h:26,type:'crystal'});
      this.obstacles.push({x:W+46, y:GY-20,w:15,h:20,type:'crystal'});
    }
  }
  spawnAerial(){
    const ay=AIR_Y_MIN+Math.floor(Math.random()*(AIR_Y_MAX-AIR_Y_MIN));
    this.obstacles.push({x:W+30,y:ay,w:44,h:12,type:'aerial'});
  }
  doJump(){
    const n=this.nj;
    if(n.onGround||n.coyote>0){
      n.vy=J_SMALL;n.onGround=false;n.coyote=0;
      n.jumpsLeft=MAX_JUMPS-1;this.holding=true;this.holdFrames=0;
    } else if(n.jumpsLeft>0){
      n.vy=J_DBL;n.jumpsLeft--;this.holding=false;
    }
  }
  doThrow(){
    if(this.projCooldown>0||this.projs.length>=MAX_PROJ)return;
    this.shotCounter++;
    if(this.shotCounter>=5){this.empoweredShot=true;this.shotCounter=0;}
    const pw=this.empoweredShot;
    this.projs.push({x:this.nj.x+NW+4,y:this.nj.y+NH*0.4,power:pw});
    this.empoweredShot=false;this.projCooldown=PROJ_COOLDOWN;
  }
  step(wantJump,wantThrow,holdJump){
    if(!this.alive)return;
    this.frame++;
    this.speed=calcSpeed(this.frame);
    if(this.holding&&this.holdFrames<12&&this.nj.vy<0){this.nj.vy+=J_BOOST;this.holdFrames++;}
    if(!holdJump)this.holding=false;
    const n=this.nj;
    n.vy+=n.vy>0?GRAV_DOWN:GRAV_UP;
    n.y+=n.vy;
    if(n.y+NH>=GY){n.y=GY-NH;n.vy=0;n.onGround=true;n.jumpsLeft=MAX_JUMPS;n.coyote=0;this.holding=false;}
    else{if(n.onGround)n.coyote=COYOTE;n.onGround=false;if(n.coyote>0)n.coyote--;}
    if(n.iframes>0)n.iframes--;
    this.nextObsPx-=this.speed;
    if(this.nextObsPx<=0){this.spawnGround();this.nextObsPx=randGap(GAP_MIN,GAP_RANGE);}
    this.nextAerialPx-=this.speed;
    if(this.nextAerialPx<=0){this.spawnAerial();this.nextAerialPx=randGap(AIR_GAP_MIN,AIR_GAP_RANGE);}
    if(this.projCooldown>0)this.projCooldown--;
    this.projs.forEach(p=>p.x+=PROJ_SPD);
    this.projs=this.projs.filter(p=>{
      if(p.x>W+PROJ_RADIUS)return false;
      for(let i=this.obstacles.length-1;i>=0;i--){
        const o=this.obstacles[i];
        if(o.type!=='aerial'&&!p.power)continue;
        const cx=o.x+o.w/2,cy=o.y+o.h/2;
        if(Math.abs(p.x-cx)<o.w/2+PROJ_RADIUS&&Math.abs(p.y-cy)<o.h/2+PROJ_RADIUS){
          this.obstacles.splice(i,1);return false;
        }
      }
      return true;
    });
    this.obstacles.forEach(o=>o.x-=this.speed);
    this.obstacles=this.obstacles.filter(o=>o.x>-80);
    if(n.iframes===0){
      const pad=3;
      for(const o of this.obstacles){
        if(n.x+pad<o.x+o.w&&n.x+NW-pad>o.x&&n.y+pad<o.y+o.h&&n.y+NH-pad>o.y){
          n.hp--;n.iframes=90;n.vy=Math.min(n.vy,-5);
          if(n.hp<=0)this.alive=false;
          break;
        }
      }
    }
  }
  getInputs(){
    const n=this.nj;
    const nearObs=this.obstacles.filter(o=>o.x>n.x-10&&o.type!=='aerial').sort((a,b)=>a.x-b.x)[0];
    const nearAir=this.obstacles.filter(o=>o.x>n.x-10&&o.type==='aerial').sort((a,b)=>a.x-b.x)[0];
    return [
      (n.y-(GY/2))/(GY/2),
      n.vy/15,
      n.onGround?1:0,
      n.jumpsLeft/MAX_JUMPS,
      nearObs?(Math.max(0,nearObs.x-n.x))/W:1,
      nearObs?(GY-nearObs.y)/GY:0,
      nearObs?(nearObs.h/60):0,
      nearAir?(Math.max(0,nearAir.x-n.x))/W:1,
      nearAir?((nearAir.y-(GY/2))/(GY/2)):0,
      this.projCooldown/PROJ_COOLDOWN,
      this.speed/10,
      n.iframes>0?1:0,
    ];
  }
}

// ════════════════════════════════════════════════════
// NeuralNetwork
// ════════════════════════════════════════════════════
class NeuralNetwork {
  constructor(layers){
    this.layers=layers;this.fitness=0;
    this.weights=[];this.biases=[];
    for(let i=0;i<layers.length-1;i++){
      const w=[];
      for(let j=0;j<layers[i+1];j++){
        const r=[];
        for(let k=0;k<layers[i];k++)r.push((Math.random()*2-1)*Math.sqrt(2/layers[i]));
        w.push(r);
      }
      this.weights.push(w);
      this.biases.push(Array.from({length:layers[i+1]},()=>0));
    }
  }
  forward(inputs){
    let act=inputs;
    for(let l=0;l<this.weights.length;l++){
      const next=[];
      for(let j=0;j<this.weights[l].length;j++){
        let s=this.biases[l][j];
        for(let k=0;k<act.length;k++)s+=this.weights[l][j][k]*act[k];
        next.push(l===this.weights.length-1?1/(1+Math.exp(-s)):Math.max(0,s));
      }
      act=next;
    }
    return act;
  }
  clone(){
    const n=new NeuralNetwork(this.layers);
    n.weights=this.weights.map(wl=>wl.map(wr=>[...wr]));
    n.biases=this.biases.map(bl=>[...bl]);
    return n;
  }
  mutate(rate){
    for(let l=0;l<this.weights.length;l++){
      for(let j=0;j<this.weights[l].length;j++){
        for(let k=0;k<this.weights[l][j].length;k++){
          if(Math.random()<rate)
            this.weights[l][j][k]+=Math.random()<0.1
              ?(Math.random()*2-1)
              :(Math.random()*2-1)*0.2;
        }
        if(Math.random()<rate)this.biases[l][j]+=(Math.random()*2-1)*0.1;
      }
    }
  }
  static crossover(a,b){
    const child=a.clone();
    for(let l=0;l<child.weights.length;l++)
      for(let j=0;j<child.weights[l].length;j++)
        for(let k=0;k<child.weights[l][j].length;k++)
          if(Math.random()<0.5)child.weights[l][j][k]=b.weights[l][j][k];
    return child;
  }
  toJSON(){return {layers:this.layers,weights:this.weights,biases:this.biases};}
  static fromJSON(data){
    const nn=new NeuralNetwork(data.layers);
    nn.weights=data.weights;nn.biases=data.biases;return nn;
  }
}

// ════════════════════════════════════════════════════
// トーナメント選択
// ════════════════════════════════════════════════════
function tournamentSelect(pop,k=3){
  let best=null;
  for(let i=0;i<k;i++){
    const c=pop[Math.floor(Math.random()*pop.length)];
    if(!best||c.fitness>best.fitness)best=c;
  }
  return best;
}

// ════════════════════════════════════════════════════
// 1世代を評価（全個体を打ち切りまで実行）
// ════════════════════════════════════════════════════
function evaluateGeneration(population){
  const games = population.map(()=>{const g=new GameInstance();g.reset();return g;});
  const jumpHolds = Array(population.length).fill(0);

  while(games.some(g=>g.alive)){
    for(let i=0;i<games.length;i++){
      const g=games[i];const nn=population[i];
      if(!g.alive)continue;
      // 打ち切り
      if(g.frame>=CONFIG.MAX_FRAMES){g.alive=false;nn.fitness=Math.max(nn.fitness,g.frame);continue;}
      const out=nn.forward(g.getInputs());
      const wantJump=out[0]>0.5,wantThrow=out[1]>0.5;
      if(wantJump){
        if(jumpHolds[i]===0)g.doJump();
        jumpHolds[i]=Math.min(jumpHolds[i]+1,12);
      } else {
        jumpHolds[i]=0;
      }
      if(wantThrow)g.doThrow();
      g.step(wantJump,wantThrow,wantJump&&jumpHolds[i]>0);
      nn.fitness=Math.max(nn.fitness,g.frame);
    }
  }
}

// ════════════════════════════════════════════════════
// メイン学習ループ
// ════════════════════════════════════════════════════
function main(){
  let population=[];
  let startGen=0;
  let history=[];

  // 前回モデルがあればロードして続きから
  if(fs.existsSync(CONFIG.MODEL_PATH)){
    try{
      const saved=JSON.parse(fs.readFileSync(CONFIG.MODEL_PATH,'utf8'));
      // ベストモデルをベースに集団を再構成
      const base=NeuralNetwork.fromJSON(saved);
      for(let i=0;i<CONFIG.POP_SIZE;i++){
        const nn=base.clone();
        if(i>0)nn.mutate(CONFIG.MUT_RATE*1.5); // 多様性を持たせる
        nn.fitness=0;
        population.push(nn);
      }
      startGen=saved._generation||0;
      console.log(`前回モデルをロード（世代 ${startGen}）して継続学習`);
    }catch(e){
      console.log('モデル読み込みエラー、新規開始:', e.message);
      population=Array.from({length:CONFIG.POP_SIZE},()=>new NeuralNetwork([12,16,10,2]));
    }
  } else {
    population=Array.from({length:CONFIG.POP_SIZE},()=>new NeuralNetwork([12,16,10,2]));
    console.log('新規学習開始');
  }

  if(fs.existsSync(CONFIG.HISTORY_PATH)){
    try{history=JSON.parse(fs.readFileSync(CONFIG.HISTORY_PATH,'utf8'));}catch(e){}
  }

  let allTimeBest=history.length>0?Math.max(...history.map(h=>h.best)):0;

  for(let gen=0;gen<CONFIG.GENERATIONS;gen++){
    population.forEach(p=>p.fitness=0);
    evaluateGeneration(population);

    population.sort((a,b)=>b.fitness-a.fitness);
    const scores=population.map(p=>p.fitness);
    const best=scores[0];
    const avg=Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
    const currentGen=startGen+gen+1;
    history.push({gen:currentGen,best,avg});
    if(best>allTimeBest)allTimeBest=best;

    if((gen+1)%50===0||gen===0||gen===CONFIG.GENERATIONS-1){
      process.stdout.write(`世代 ${currentGen}: best=${best} avg=${avg} 全時間最高=${allTimeBest}\n`);
    }

    // 次世代生成
    const next=[];
    for(let i=0;i<Math.min(CONFIG.ELITE,population.length);i++)next.push(population[i].clone());
    while(next.length<CONFIG.POP_SIZE){
      const child=NeuralNetwork.crossover(tournamentSelect(population),tournamentSelect(population));
      child.mutate(CONFIG.MUT_RATE);next.push(child);
    }
    population=next.slice(0,CONFIG.POP_SIZE);
  }

  // 最良個体を保存
  const best=population.reduce((a,b)=>a.fitness>b.fitness?a:b,population[0]);
  const modelData={...best.toJSON(),_generation:startGen+CONFIG.GENERATIONS,_fitness:best.fitness};
  fs.writeFileSync(CONFIG.MODEL_PATH,JSON.stringify(modelData));
  fs.writeFileSync(CONFIG.HISTORY_PATH,JSON.stringify(history));
  console.log(`\n完了！最良スコア=${best.fitness} → ai_model.json に保存`);
}

main();
