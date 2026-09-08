# Parcours navigateur automatisé (pip install playwright ; playwright install chromium). Base vide requise.
import asyncio, re
from playwright.async_api import async_playwright
B='http://localhost:5000'
errors=[]
async def login(br, u):
    ctx = await br.new_context(viewport={'width':1360,'height':900}, locale='fr-FR')
    await ctx.route(re.compile(r'fonts\.(googleapis|gstatic)\.com'), lambda r: r.abort())
    ctx.set_default_timeout(15000)
    p = await ctx.new_page()
    p.on('console', lambda m: errors.append((u, m.text)) if m.type=='error' else None)
    p.on('pageerror', lambda e: errors.append((u, 'PAGEERROR '+str(e))))
    await p.goto(B+'/login'); await p.fill('#username', u); await p.fill('#password', u); await p.click('button[type=submit]')
    await p.wait_for_url(re.compile(r'/(commercial|implantation|direction|admin)/')); await p.wait_for_timeout(600)
    return p
async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        # ---- Commercial : nouvelle demande via l'UI
        com = await login(br, 'com1')
        await com.screenshot(path='tests/captures/s1_com_dashboard.png', full_page=True)
        await com.click('nav button[data-tab=nouvelle]'); await com.wait_for_selector('#nTitre')
        await com.fill('#nTitre', 'Ligne précalibrage pomme 20 T/h'); await com.fill('#nProduits', 'Pomme'); await com.fill('#nVarietes', 'Gala, Golden')
        await com.fill('#nTh', '20'); await com.fill('#nTa', '25000'); await com.fill('#nTt', '8 h/j'); await com.fill('#nRetour', '2026-10-15'); await com.fill('#nDesc', 'Projet fictif de test UI')
        await com.check('.checks input[value=emballage]')
        await com.screenshot(path='tests/captures/s2_com_nouvelle.png', full_page=True)
        await com.click('#nCreate')
        await com.wait_for_url(re.compile(r'/cdc/precalibrage\.html\?demande=')); await com.wait_for_timeout(1200)
        # page CDC préremplie ?
        client = await com.input_value('#in_7'); th = await com.input_value('#in_84'); email = await com.input_value('#in_129')
        print('CDC prérempli → client:', client, '| T/h:', th, '| email:', email)
        assert client.startswith('CLIENT') and th=='20' and 'com1@' in email
        await com.screenshot(path='tests/captures/s3_cdc_precal.png', full_page=False)
        # Remplir un champ → sauvegarde auto
        await com.fill('#in_62', 'Note de test — sauvegarde auto'); await com.wait_for_timeout(1500)
        st = await com.inner_text('#statutSauve'); print('Statut sauvegarde:', st); assert 'demande' in st
        # Terminer avec champs manquants → bandeau d'erreur
        await com.evaluate('allerPage(6)'); await com.wait_for_timeout(300); await com.click('.b-nav.env'); await com.wait_for_timeout(500)
        bando = await com.inner_text('#bandoErr'); print('Bandeau erreurs:', bando[:90]); assert 'obligatoire' in bando
        await com.screenshot(path='tests/captures/s4_cdc_erreurs.png', full_page=False)
        # Retour à la demande
        did = re.search(r'demande=([^&]+)', com.url).group(1)
        await com.goto(B+'/?d='+did); await com.wait_for_selector('.dhead'); await com.wait_for_timeout(500)
        await com.screenshot(path='tests/captures/s5_com_fiche_brouillon.png', full_page=True)
        assert await com.is_disabled('#aEnvoyer'), 'envoi doit être désactivé'
        # Compléter les CDC par API (raccourci) puis recharger et envoyer
        await com.evaluate(f"""async () => {{
          await fetch('/api/demandes/{did}/cdc/precalibrage', {{method:'PUT', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{data:{{v:1,f:{{}}}}, complet:true}})}});
          await fetch('/api/demandes/{did}/cdc/emballage', {{method:'PUT', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{data:{{v:1,f:{{produits:'Pomme',debit:'20',colis:'Plateaux'}}}}, complet:true}})}});
        }}""")
        await com.goto(B+'/?d='+did); await com.wait_for_selector('#aEnvoyer:not([disabled])')
        await com.click('#aEnvoyer'); await com.wait_for_selector('#mOk'); await com.click('#mOk'); await com.wait_for_timeout(800)
        assert 'Envoyée' in await com.inner_text('#app'); print('✅ Commercial : demande envoyée')
        # ---- Implantation
        impl = await login(br, 'impl1')
        await impl.screenshot(path='tests/captures/s6_impl_atraiter.png', full_page=True)
        await impl.goto(B+'/?d='+did); await impl.wait_for_selector('#aPrendre'); await impl.click('#aPrendre'); await impl.wait_for_timeout(700)
        await impl.click('#aPlan'); await impl.wait_for_selector('#pFic'); await impl.fill('#pFic', 'CLIENTA_precal_indA.dwg'); await impl.fill('#pComm', 'Première implantation'); await impl.click('#mOk'); await impl.wait_for_timeout(700)
        await impl.screenshot(path='tests/captures/s7_impl_fiche.png', full_page=True)
        await impl.click('#aValid'); await impl.wait_for_selector('#vComm'); await impl.click('#mOk'); await impl.wait_for_timeout(800)
        assert 'à valider' in (await impl.inner_text('#app')).lower(); print('✅ Implantation : plan A envoyé en validation')
        # ---- DT refuse puis valide B
        dt = await login(br, 'dt1')
        await dt.screenshot(path='tests/captures/s8_dt_avalider.png', full_page=True)
        await dt.goto(B+'/?d='+did); await dt.wait_for_selector('#aRefus'); await dt.click('#aRefus'); await dt.wait_for_selector('#rNote')
        await dt.click('#mOk'); await dt.wait_for_timeout(500)  # sans motif → doit rester ouvert
        assert await dt.query_selector('#modal'), 'modale doit rester ouverte sans motif'
        await dt.fill('#rNote', 'Manque la zone de stockage des palox vides'); await dt.click('#mOk'); await dt.wait_for_timeout(800)
        await dt.screenshot(path='tests/captures/s9_dt_refus.png', full_page=True)
        print('✅ DT : refus motivé')
        # impl reprend : nouvel indice B
        await impl.goto(B+'/?d='+did); await impl.wait_for_selector('#aPlan'); 
        assert 'refusé' in (await impl.inner_text('.alertbar')).lower()
        await impl.click('#aPlan'); await impl.wait_for_selector('#pFic'); await impl.fill('#pFic', 'CLIENTA_precal_indB.dwg'); await impl.click('#mOk'); await impl.wait_for_timeout(700)
        await impl.click('#aValid'); await impl.wait_for_selector('#vComm'); await impl.fill('#vComm', 'Zone palox ajoutée'); await impl.click('#mOk'); await impl.wait_for_timeout(800)
        await dt.goto(B+'/?d='+did); await dt.wait_for_selector('#aValider'); await dt.click('#aValider'); await dt.wait_for_selector('#vNote'); await dt.fill('#vNote', 'OK pour chiffrage'); await dt.click('#mOk'); await dt.wait_for_timeout(800)
        await dt.screenshot(path='tests/captures/s10_dt_valide.png', full_page=True)
        print('✅ DT : indice B validé')
        # ---- Commercial voit validé + notif + devis
        await com.goto(B+'/commercial/'); await com.wait_for_selector('.kpis'); await com.wait_for_timeout(600)
        n = await com.inner_text('#bellN'); print('Notifs non lues commercial:', n); assert int(n) >= 2
        await com.click('#bell'); await com.wait_for_selector('#notifs'); await com.screenshot(path='tests/captures/s11_com_notifs.png')
        await com.click(f'#notifs .it[data-d="{did}"]'); await com.wait_for_selector('#aDevis'); await com.click('#aDevis'); await com.wait_for_selector('#dvNum'); await com.fill('#dvNum', 'DV-2026-0042'); await com.click('#mOk'); await com.wait_for_timeout(800)
        await com.screenshot(path='tests/captures/s12_com_fiche_validee.png', full_page=True)
        assert 'Chiffrée' in await com.inner_text('#app'); print('✅ Commercial : chiffrage déclaré')
        # CDC en lecture côté DT
        await dt.goto(B+f'/cdc/precalibrage.html?demande={did}&lecture=1'); await dt.wait_for_timeout(1200)
        assert await dt.is_disabled('#in_7'); await dt.screenshot(path='tests/captures/s13_cdc_lecture.png')
        print('✅ CDC lecture seule OK')
        # Admin
        adm = await login(br, 'admin'); await adm.screenshot(path='tests/captures/s14_admin.png', full_page=True)
        await adm.click('nav button[data-tab=mails]'); await adm.wait_for_timeout(600); await adm.screenshot(path='tests/captures/s15_mails.png', full_page=True)
        await br.close()
    print('\nErreurs console :', errors if errors else 'aucune')
asyncio.run(main())
