# Репозиторий планов

Планы живут в `~/Documents/marathon-plans/`, папка на человека, приватный
локальный git.

Проверка: `ls ~/Documents/marathon-plans/`. Если папки нет, спроси «создать
папку планов в ~/Documents/marathon-plans?» и после согласия:

```bash
mkdir -p ~/Documents/marathon-plans
cd ~/Documents/marathon-plans
git init -q
printf ".DS_Store\n" > .gitignore
git add . && git commit -q -m "Старт: планы подготовки к забегам"
```

Папка человека: `~/Documents/marathon-plans/<имя-латиницей>/` с `plan.md` и
`plan.html`. При пересборке старый `plan.md` остаётся в истории git, отдельные
версии не плоди.

**Важно:** репо приватный и локальный. Не создавать удалённый репозиторий, не
пушить, не подключать GitHub без явной просьбы.
