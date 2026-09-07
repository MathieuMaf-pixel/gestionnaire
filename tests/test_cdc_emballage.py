# Parcours navigateur du CDC Emballage (pip install playwright ; playwright install chromium). Serveur lancé, base vide.
import asyncio, re, json
from playwright.async_api import async_playwright
B='http://localhost:5000'
errors=[]
async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        ctx = await br.new_context(viewport={'width':1280,'height':900}, locale='fr-FR')
        await ctx.route(re.compile(r'fonts\.(googleapis|gstatic)\.com'), lambda r: r.abort())
        ctx.set_default_timeout(15000)
        p = await ctx.new_page()
        p.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
        p.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
        await p.goto(B+'/login'); await p.fill('#username','com1'); await p.fill('#password','com1'); await p.click('button[type=submit]'); await p.wait_for_url(re.compile('/commercial/'))
        # créer une demande emballage via API
        did = await p.evaluate("""async () => { const c = await (await fetch('/api/clients')).json();
          const r = await fetch('/api/demandes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:c[0].id,titre:'Station emballage 3 lignes',produits:'Pomme, Poire',tonnage_horaire:'25',tonnage_annuel:'30000',retour_souhaite:'20/10/2026',cdc_types:['emballage'],description:'Test emballage'})});
          return (await r.json()).id; }""")
        await p.goto(B+f'/cdc/emballage.html?demande={did}'); await p.wait_for_selector('.page'); await p.wait_for_timeout(500)
        # préremplissage
        assert (await p.input_value('[data-bind="gen.client"]')).startswith('CLIENT'), 'client prérempli'
        assert await p.input_value('[data-bind="gen.tonnageH"]') == '25'
        assert await p.is_checked('input[data-bind="gen.fruits"][value="Pomme"]') and await p.is_checked('input[data-bind="gen.fruits"][value="Poire"]')
        assert await p.input_value('[data-bind="gen.retour"]') == '20/10/2026'
        await p.screenshot(path='tests/captures/e1_general.png', full_page=True)
        print('✅ Général prérempli')
        # Projet : mode neuf
        await p.click('.tab:has-text("Projet")'); await p.wait_for_selector('.b-choix')
        await p.click('.b-choix[data-val="neuf"]'); await p.wait_for_timeout(300)
        assert len(await p.query_selector_all('[data-bind^="lignes."][data-bind$=".nom"]')) == 2
        await p.click('[data-add-ligne]'); await p.wait_for_timeout(200)
        await p.fill('[data-bind="lignes.0.nom"]', 'Ligne plateaux'); await p.fill('[data-bind="lignes.1.nom"]', 'Ligne flowpack'); await p.fill('[data-bind="lignes.2.nom"]', 'Ligne caisses')
        await p.fill('[data-bind="lignes.0.debit"]', '10 T/h')
        tabs = [await t.inner_text() for t in await p.query_selector_all('.tab')]
        print('Onglets neuf :', tabs); assert 'Vidage' in tabs and 'Palettisation' in tabs and 'Schéma' in tabs
        await p.screenshot(path='tests/captures/e2_projet.png', full_page=True)
        # Palox & formats
        await p.click('.tab:has-text("Palox")'); await p.wait_for_selector('[data-add="palox"]')
        await p.click('[data-add="palox"]'); await p.click('[data-add="palox"]'); await p.wait_for_timeout(200)
        await p.fill('[data-bind="palox.0.nom"]', 'Palox bois 1200'); await p.fill('[data-bind="palox.1.nom"]', 'Palox plastique')
        await p.click('[data-add="formats"]'); await p.wait_for_timeout(200)
        await p.fill('[data-bind="formats.0.nom"]', 'Plateau 60x40 1 rang'); await p.fill('[data-bind="formats.0.L"]', '600'); await p.fill('[data-bind="formats.0.l"]', '400'); await p.fill('[data-bind="formats.0.h"]', '110'); await p.fill('[data-bind="formats.0.poids"]', '7')
        await p.check('input[data-bind="formats.0.palettes"][value^="1200 × 1000"]')
        await p.click('[data-add="formats"]'); await p.wait_for_timeout(200)
        await p.fill('[data-bind="formats.1.nom"]', 'Sachet 1 kg'); await p.fill('[data-bind="formats.1.L"]', '300'); await p.fill('[data-bind="formats.1.l"]', '200'); await p.fill('[data-bind="formats.1.h"]', '80'); await p.fill('[data-bind="formats.1.poids"]', '1')
        await p.screenshot(path='tests/captures/e3_catalogues.png', full_page=True)
        print('✅ Catalogues')
        # Vidage mixte : commun L1+L2, indépendant L3
        await p.click('.tab:has-text("Vidage")'); await p.wait_for_selector('.b-choix[data-val="mixte"]'); await p.click('.b-choix[data-val="mixte"]'); await p.wait_for_timeout(200)
        assert 'Lignes sans vidage' in await p.inner_text('.page')
        await p.click('[data-add-vidage]'); await p.wait_for_timeout(200)
        await p.check('input[data-bind="vidage.groupes.0.type"][value="DIR 3"]'); await p.wait_for_timeout(200)
        pu = await p.query_selector_all('.puce[data-toggle="vidage.groupes.0.lignes"]'); await pu[0].click(); await p.wait_for_timeout(150); pu = await p.query_selector_all('.puce[data-toggle="vidage.groupes.0.lignes"]'); await pu[1].click(); await p.wait_for_timeout(150)
        pp = await p.query_selector_all('.puce[data-toggle="vidage.groupes.0.palox"]'); await pp[0].click(); await p.wait_for_timeout(150)
        await p.check('input[data-bind="vidage.groupes.0.opts.lavage"][value="Oui"]'); await p.wait_for_timeout(100)
        await p.click('[data-add-vidage]'); await p.wait_for_timeout(200)
        await p.check('input[data-bind="vidage.groupes.1.type"][value="Robobin"]'); await p.wait_for_timeout(200)
        pu = await p.query_selector_all('.puce[data-toggle="vidage.groupes.1.lignes"]'); await pu[2].click(); await p.wait_for_timeout(150)
        pp = await p.query_selector_all('.puce[data-toggle="vidage.groupes.1.palox"]'); await pp[1].click(); await p.wait_for_timeout(150)
        txt = await p.inner_text('.page'); assert 'Toutes les lignes ont un vidage' in txt, txt[:300]
        await p.screenshot(path='tests/captures/e4_vidage.png', full_page=True)
        print('✅ Vidage mixte')
        # Lignes : machines + accessoires + formats
        await p.click('.tab:has-text("Lignes")'); await p.wait_for_selector('#selMachine')
        assert 'Vidage 1' in await p.inner_text('.page')
        for k in ['tapis3','fastpack']:
            await p.select_option('#selMachine', k); await p.click('[data-add-machine]'); await p.wait_for_timeout(200)
        await p.click('.puce[data-toggle="lignes.0.machines.1.acc"][data-id="etiqueteuse_plateau"]'); await p.wait_for_timeout(150)
        await p.fill('[data-bind="lignes.0.machines.1.opts.tetes"]', '4')
        await p.click('.puce[data-toggle="lignes.0.formats"]'); await p.wait_for_timeout(150)
        await p.uncheck('input[data-bind="lignes.0.tete.brosseuse.actif"]') if await p.is_checked('input[data-bind="lignes.0.tete.brosseuse.actif"]') else None
        await p.check("input[data-bind='lignes.0.tete.cuve.opts.type'][value=\"Dans l'eau\"]")
        await p.screenshot(path='tests/captures/e5_ligne1.png', full_page=True)
        # ligne 2
        await p.click('.sous-tab:has-text("L2")'); await p.wait_for_timeout(200)
        await p.select_option('#selMachine', 'flowpack'); await p.click('[data-add-machine]'); await p.wait_for_timeout(200)
        await p.click('.puce[data-toggle="lignes.1.machines.0.acc"][data-id="ulma"]'); await p.wait_for_timeout(150)
        f = await p.query_selector_all('.puce[data-toggle="lignes.1.formats"]'); await f[1].click(); await p.wait_for_timeout(150)
        # ligne 3
        await p.click('.sous-tab:has-text("L3")'); await p.wait_for_timeout(200)
        await p.select_option('#selMachine', 'remplisseur_caisses'); await p.click('[data-add-machine]'); await p.wait_for_timeout(200)
        await p.click('.puce[data-toggle="lignes.2.machines.0.acc"][data-id="scotcheuse"]'); await p.wait_for_timeout(150)
        f = await p.query_selector_all('.puce[data-toggle="lignes.2.formats"]'); await f[0].click(); await p.wait_for_timeout(150)
        print('✅ Lignes')
        # Palettisation mutualisée
        await p.click('.tab:has-text("Palettisation")'); await p.wait_for_selector('.b-choix[data-val="mutu"]'); await p.click('.b-choix[data-val="mutu"]'); await p.wait_for_timeout(200)
        await p.click('[data-palett-auto="mutu"]'); await p.wait_for_timeout(200)
        await p.check('input[data-bind="palettisation.groupes.0.type"][value="Palettiseur automatique"]'); await p.wait_for_timeout(200)
        await p.check('input[data-bind="palettisation.groupes.0.opts.cercleuse"][value^="Liaison"]')
        assert 'Toutes les lignes ont un palettisation' in await p.inner_text('.page')
        await p.screenshot(path='tests/captures/e6_palett.png', full_page=True)
        # Schéma
        await p.click('.tab:has-text("Schéma")'); await p.wait_for_selector('#schemaWrap svg')
        await p.screenshot(path='tests/captures/e7_schema.png', full_page=True)
        prog = await p.inner_text('#txtReq'); print('Progression :', prog)
        # Terminer
        await p.click('.b-nav.env'); await p.wait_for_timeout(800)
        if await p.query_selector('#bandoErr.visible'): print('Bandeau :', await p.inner_text('#bandoErr'))
        await p.wait_for_url(re.compile('/commercial/')); await p.wait_for_timeout(600)
        txt = await p.inner_text('#app'); assert 'CDC Emballage' in txt and 'Complet' in txt, txt[:500]
        print('✅ CDC emballage terminé → complet dans la demande')
        # Réouverture : données conservées ?
        await p.goto(B+f'/cdc/emballage.html?demande={did}'); await p.wait_for_selector('.page'); await p.wait_for_timeout(400)
        st = await p.evaluate('JSON.stringify({m:S.projet.mode, n:S.lignes.length, v:S.vidage.groupes.length, f:S.formats.length, mach:S.lignes.map(l=>l.machines.length)})'); print('Rechargé :', st)
        assert json.loads(st)['n']==3 and json.loads(st)['v']==2
        # PDF recap
        await p.evaluate('construireRecap()'); rec = await p.inner_text('#recapPdf') if False else await p.evaluate("document.getElementById('recapPdf').innerText")
        assert 'Ligne flowpack' in rec and 'Flowpack' in rec and 'Palettiseur automatique' in rec and 'Plateau 60x40' in rec
        await p.emulate_media(media='print'); await p.screenshot(path='tests/captures/e8_pdf.png', full_page=True); await p.emulate_media(media='screen')
        print('✅ Récap PDF')
        # ---- Mode unique (autonome, localStorage)
        await p.goto(B+'/cdc/emballage.html'); await p.wait_for_selector('.page'); await p.click('#btnRaz') if False else None
        await p.evaluate("localStorage.removeItem('cdc-emballage-v2'); location.reload()"); await p.wait_for_selector('.page')
        await p.click('.tab:has-text("Projet")'); await p.click('.b-choix[data-val="unique"]'); await p.wait_for_timeout(200)
        tabs = [await t.inner_text() for t in await p.query_selector_all('.tab')]; print('Onglets unique :', tabs); assert 'Vidage' not in tabs and 'La ligne' in tabs
        await p.click('.tab:has-text("La ligne")'); await p.wait_for_timeout(200)
        txt = await p.inner_text('.page'); assert 'Type de vidage' in txt and 'Type de palettisation' in txt
        await p.screenshot(path='tests/captures/e9_unique.png', full_page=True)
        print('✅ Mode unique')
        # ---- Mode modif
        await p.click('.tab:has-text("Projet")'); await p.click('.b-choix[data-val="modif"]'); await p.wait_for_timeout(200)
        await p.click('.tab:has-text("Lignes existantes")'); await p.wait_for_timeout(200)
        await p.check('input[data-bind="lignes.0.existant.conditionnement.modifier"]'); await p.wait_for_timeout(200)
        await p.select_option('select[data-bind="lignes.0.existant.conditionnement.remplacer"]', 'Flowpack'); await p.wait_for_timeout(200)
        await p.fill('textarea[data-bind="lignes.0.existant.conditionnement.notes"]', 'Remplacer la ligne manuelle par une flowpack')
        await p.click('.tab:has-text("Schéma")'); await p.wait_for_selector('#schemaWrap svg'); await p.screenshot(path='tests/captures/e10_modif_schema.png', full_page=True)
        print('✅ Mode modification')
        await br.close()
    print('Erreurs console :', [e for e in errors if 'ERR_FAILED' not in e] or 'aucune')
asyncio.run(main())
