/* Restaura os dados do checkout quando o usuario volta pelo navegador */
(function(){
  function load(k){ try{ return JSON.parse(localStorage.getItem(k)||'null')||{}; }catch(e){ return {}; } }
  function mCpf(v){ v=(v||'').replace(/\D/g,'').slice(0,11); return v.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2'); }
  function mTel(v){ v=(v||'').replace(/\D/g,'').slice(0,11); if(v.length<=10) return v.replace(/(\d{2})(\d)/,'($1) $2').replace(/(\d{4})(\d)/,'$1-$2'); return v.replace(/(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2'); }
  function mCep(v){ v=(v||'').replace(/\D/g,'').slice(0,8); return v.replace(/(\d{5})(\d)/,'$1-$2'); }
  function setPh(ph,val){
    if(!val) return;
    var el=document.querySelector('input[placeholder="'+ph+'"]');
    if(el && !el.value){ el.value=val; el.dispatchEvent(new Event('input',{bubbles:true})); }
  }
  function setId(id,val){
    if(!val) return;
    var el=document.getElementById(id);
    if(el && !el.value){ el.value=val; el.dispatchEvent(new Event('input',{bubbles:true})); }
  }
  function restore(){
    var d=load('dadosPessoais'), e=load('dadosEndereco');
    setPh('Nome e Sobrenome', d.nome);
    setPh('email@email.com', d.email);
    setPh('123.456.789-12', mCpf(d.cpf));
    setPh('(99) 99999-9999', mTel(d.telefone));
    setId('lv-cep', mCep(e.cep));
    setId('lv-endereco', e.logradouro);
    setId('lv-numero', e.numero);
    setId('lv-complemento', e.complemento);
    setId('lv-bairro', e.bairro);
    setId('lv-cidade', e.cidade);
    setId('lv-uf', e.uf);
  }
  function run(){ try{ restore(); }catch(_e){} setTimeout(function(){ try{ restore(); }catch(_e){} }, 400); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', run); else run();
  window.addEventListener('pageshow', function(ev){ if(ev.persisted) run(); });
})();
