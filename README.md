# coc-typeprof

> fork from a [typeprof/vscode](https://github.com/ruby/typeprof/tree/master/vscode)

[Ruby TypeProf](https://marketplace.visualstudio.com/items?itemName=mame.ruby-typeprof) extension for [coc.nvim](https://github.com/neoclide/coc.nvim)

## **!!Note & Warning!!**

I don't use ruby regularly, so if you like ruby, please refer to this repository and create `coc-typeprof` by yourself.

## Install

You need to have [coc.nvim](https://github.com/neoclide/coc.nvim) installed for this extension to work.

**vim-plug**:

```vim
Plug 'yaegassy/coc-typeprof', {'do': 'yarn install --frozen-lockfile'}
```

**CocInstall**:

not support.

## Configuration options

- `typeprof.enable`: Enable coc-typeprof extension, default: `true`
- `typeprof.server.path`: Path to typeprof executable. (e.g. /usr/local/bin/bundle), default: `null`

## Commands

- `typeprof.restart`: Restart

## Thanks

- [ruby/typeprof](https://github.com/ruby/typeprof/)

## License

MIT

---

> This extension is built with [create-coc-extension](https://github.com/fannheyward/create-coc-extension)
