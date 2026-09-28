# Sówki – termin spotkania rodziców

Prosty kalendarz, w którym rodzice zaznaczają dni pasujące na spotkanie. Strona działa na GitHub Pages, a dane trafiają do arkusza Google (przez Google Apps Script).

- Każdy rodzic może zaznaczyć wiele dni naraz. Przy zapisie trzeba podać imię dziecka.
- Wszyscy mogą edytować wszystkie wpisy.
- Zakładka **Wyniki** pokazuje, które dni pasują najbardziej, wraz z liczbą głosów i imionami.
- Administrator może usuwać wpisy oraz zamknąć głosowanie, ogłaszając wybrany termin.
- Dostęp jest chroniony hasłem. Hasła sprawdza serwer (Apps Script), więc nie ma ich w kodzie tej strony.

## Wdrożenie backendu (jednorazowo, ok. 5 minut)

1. Utwórz nowy arkusz na [sheets.new](https://sheets.new) i nazwij go np. „Sówki – spotkanie”.
2. W arkuszu wybierz **Rozszerzenia → Apps Script**.
3. Usuń zawartość pliku `Kod.gs` i wklej zawartość pliku `apps-script/Code.gs`.
   Na górze pliku wpisz swoje hasła w `USER_PASSWORD` i `ADMIN_PASSWORD`.
4. Zapisz (ikona dyskietki), a potem wybierz **Wdróż → Nowe wdrożenie**.
   - Typ: **Aplikacja internetowa**
   - Wykonuj jako: **Ja**
   - Kto ma dostęp: **Każdy**
5. Kliknij **Wdróż** i zaakceptuj uprawnienia. Google pokaże ostrzeżenie o niezweryfikowanej aplikacji, bo to Twój własny skrypt: wybierz **Zaawansowane → Przejdź do projektu**.
6. Skopiuj **URL aplikacji internetowej** (kończy się na `/exec`) i wklej go do `API_URL` w pliku `config.js`.

Wpisy pojawią się w arkuszu w zakładce **Wpisy**.

### Zmiany w skrypcie

Po każdej zmianie w Apps Script wybierz **Wdróż → Zarządzaj wdrożeniami → ✏️ → Wersja: Nowa wersja → Wdróż**. Adres URL się nie zmieni.

## Uruchomienie lokalne

```bash
python3 -m http.server 8765
```

Gdy `API_URL` w `config.js` jest pusty, strona działa w trybie demo: dane zapisują się tylko w przeglądarce, a hasła testowe to `demo` i `admin`.
